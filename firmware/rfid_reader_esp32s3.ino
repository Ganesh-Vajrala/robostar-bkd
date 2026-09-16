/**
 * Massage Box - RFID wallet flow (ESP32-S3 + RC522)
 * ------------------------------------------------------------------
 * What this does, end-to-end:
 *   1. Wait for a card tap on the RC522.
 *   2. Read the card UID (hex).
 *   3. (Optional) ask backend for the balance and show it.
 *   4. For the selected package, POST /api/v1/rfid/charge with a unique
 *      client_txn_id (idempotency). Backend checks balance, deducts
 *      atomically, and returns PAID + duration_sec.
 *   5. If PAID -> pulse the RELAY / chair START button, run countdown,
 *      then tell backend the session STARTED (and ENDED at the finish).
 *
 * SECURITY MODEL (important):
 *   - The card is only an IDENTITY. Balance lives on the SERVER.
 *   - The chair starts ONLY after the backend replies "PAID".
 *   - client_txn_id makes retries safe (no double charge).
 *
 * LIBRARIES (install via Arduino Library Manager):
 *   - "MFRC522" by GithubCommunity
 *   - "ArduinoJson" by Benoit Blanchon
 *   (WiFi + HTTPClient are part of the ESP32 core)
 *
 * WIRING (RC522 <-> ESP32-S3). RC522 is 3.3V ONLY - do NOT use 5V.
 *   RC522 SDA/SS  -> GPIO 10
 *   RC522 SCK     -> GPIO 12
 *   RC522 MOSI    -> GPIO 11
 *   RC522 MISO    -> GPIO 13
 *   RC522 RST     -> GPIO 9
 *   RC522 3.3V    -> 3V3
 *   RC522 GND     -> GND
 *   RELAY / chair-start opto IN -> GPIO 4  (drives your relay/opto module)
 *
 *   NOTE: On the Waveshare 4.3" board many pins are used by the RGB LCD.
 *   Confirm free GPIOs for your exact board and adjust the #defines below.
 * ------------------------------------------------------------------ */

#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>

// ---------- CONFIG: edit these ----------
const char* WIFI_SSID     = "YOUR_WIFI";
const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";
const char* BASE_URL      = "http://192.168.1.50:3000"; // your backend
const char* MACHINE_KEY   = "change_me_to_a_long_random_string"; // == MACHINE_API_KEY
const char* MACHINE_ID    = "MC-HYD-001";
const char* PACKAGE_ID    = "PKG_10";   // which package this tap buys (from UI later)

// ---------- Pins ----------
#define RC522_SS   10
#define RC522_RST   9
#define RC522_SCK  12
#define RC522_MOSI 11
#define RC522_MISO 13
#define RELAY_PIN   4      // drives relay/opto that starts the chair

MFRC522 mfrc522(RC522_SS, RC522_RST);

// ---------- helpers ----------
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi connecting");
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print("."); }
  Serial.println(" connected: " + WiFi.localIP().toString());
}

String uidToHex(MFRC522::Uid uid) {
  String s = "";
  for (byte i = 0; i < uid.size; i++) {
    if (uid.uidByte[i] < 0x10) s += "0";
    s += String(uid.uidByte[i], HEX);
  }
  s.toUpperCase();
  return s;
}

// Cheap unique-ish txn id: machine + millis + random. Good enough for idempotency.
String makeTxnId() {
  return String(MACHINE_ID) + "-" + String(millis()) + "-" + String(random(0, 999999));
}

// GET balance for a card (optional, for showing on screen)
long getBalance(const String& cardUid) {
  HTTPClient http;
  String url = String(BASE_URL) + "/api/v1/rfid/balance/" + cardUid;
  http.begin(url);
  http.addHeader("X-Machine-Key", MACHINE_KEY);
  int code = http.GET();
  long paise = -1;
  if (code == 200) {
    StaticJsonDocument<256> doc;
    if (!deserializeJson(doc, http.getString()))
      paise = doc["balance_paise"] | -1;
  }
  http.end();
  return paise;
}

// POST charge. Returns true if PAID; fills sessionId + durationSec.
bool chargeCard(const String& cardUid, String& sessionId, int& durationSec, String& statusOut) {
  HTTPClient http;
  String url = String(BASE_URL) + "/api/v1/rfid/charge";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Machine-Key", MACHINE_KEY);

  StaticJsonDocument<256> body;
  body["machine_id"]    = MACHINE_ID;
  body["card_uid"]      = cardUid;
  body["package_id"]    = PACKAGE_ID;
  body["client_txn_id"] = makeTxnId();
  String payload; serializeJson(body, payload);

  int code = http.POST(payload);
  String resp = http.getString();
  http.end();

  StaticJsonDocument<384> doc;
  if (deserializeJson(doc, resp)) { statusOut = "PARSE_ERR"; return false; }
  statusOut = String((const char*)(doc["status"] | "ERROR"));

  if (statusOut == "PAID") {
    sessionId   = String((const char*)(doc["session_id"] | ""));
    durationSec = doc["duration_sec"] | 0;
    return true;
  }
  return false; // INSUFFICIENT_BALANCE / CARD_NOT_FOUND / etc.
}

void postSessionEvent(const String& sessionId, const char* event) {
  HTTPClient http;
  String url = String(BASE_URL) + "/api/v1/sessions/" + sessionId + "/" + event;
  http.begin(url);
  http.addHeader("X-Machine-Key", MACHINE_KEY);
  http.POST("");
  http.end();
}

// ---------- chair control ----------
// Method A (power/opto): close relay to enable/start, open to stop.
// Method B (button emulation): make startChair() a short pulse across the
//   chair's AUTO-program button instead of holding the relay.
void startChair()  { digitalWrite(RELAY_PIN, HIGH); }
void stopChair()   { digitalWrite(RELAY_PIN, LOW);  }

void runSession(const String& sessionId, int durationSec) {
  Serial.printf("Starting chair for %d sec (session %s)\n", durationSec, sessionId.c_str());
  startChair();
  postSessionEvent(sessionId, "started");

  // Local countdown (the timer MUST live here, not the cloud).
  for (int remaining = durationSec; remaining > 0; remaining--) {
    // TODO: draw `remaining` on the LVGL screen here.
    if (remaining % 30 == 0 || remaining <= 5)
      Serial.printf("  remaining: %d s\n", remaining);
    delay(1000);
  }

  // NOTE: for a real chair, prefer triggering the chair's AUTO program so it
  // returns to the upright/home position by itself, and only cut power after a
  // home-position sensor confirms it's safe. See project notes.
  stopChair();
  postSessionEvent(sessionId, "ended");
  Serial.println("Session ENDED.");
}

// ---------- Arduino lifecycle ----------
void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(RELAY_PIN, OUTPUT);
  stopChair(); // fail-safe: chair OFF at boot

  connectWiFi();

  SPI.begin(RC522_SCK, RC522_MISO, RC522_MOSI, RC522_SS);
  mfrc522.PCD_Init();
  randomSeed(esp_random());
  Serial.println("Tap a card...");
}

void loop() {
  if (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial()) {
    delay(120);
    return;
  }

  String cardUid = uidToHex(mfrc522.uid);
  Serial.println("Card: " + cardUid);

  long bal = getBalance(cardUid);
  if (bal >= 0) Serial.printf("Balance: Rs.%.2f\n", bal / 100.0);

  String sessionId, status;
  int durationSec = 0;
  bool paid = chargeCard(cardUid, sessionId, durationSec, status);

  if (paid) {
    runSession(sessionId, durationSec);
  } else {
    Serial.println("Charge failed: " + status); // show on screen
  }

  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
  delay(1500); // debounce before next tap
}
