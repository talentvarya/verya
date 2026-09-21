package com.veyra.tracker;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.text.InputFilter;
import android.text.InputType;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    static final String API = "https://verya-r4wm.onrender.com";
    static final String PREFS = "veyra_tracker";
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private EditText phone, otp; private TextView status; private Button request, verify, start, camera, microphone; private String pendingPhoneValue, pendingOtpCode; private boolean verifyInProgress;
    private SharedPreferences prefs;

    @Override public void onCreate(Bundle state) { super.onCreate(state); prefs = getSharedPreferences(PREFS, MODE_PRIVATE); buildUi(); if (paired()) lockPairingUi(); }
    private void buildUi() {
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(32, 48, 32, 32);
        TextView title = new TextView(this); title.setText("Veyra Tracker\nMobile GPS device"); title.setTextSize(24); root.addView(title);
        TextView info = new TextView(this); info.setText("Pair this phone with your Veyra account. Location tracking starts after Notifications and Location ‘Allow all the time’ permissions are granted. Camera and microphone are temporarily disabled."); root.addView(info);
        phone = field("10-digit mobile number"); phone.setInputType(InputType.TYPE_CLASS_PHONE); phone.setFilters(new InputFilter[]{new InputFilter.LengthFilter(10)}); root.addView(phone);
        request = button("Send OTP"); root.addView(request); request.setOnClickListener(v -> requestOtp());
        otp = field("OTP code"); otp.setInputType(2); root.addView(otp);
        verify = button("Verify and pair"); root.addView(verify); verify.setOnClickListener(v -> verifyPairing());
        start = button("Start background tracking"); root.addView(start); start.setEnabled(false); start.setOnClickListener(v -> startTracking());
        camera = button("Vehicle camera (temporarily disabled)"); root.addView(camera); camera.setVisibility(View.GONE); camera.setOnClickListener(v -> enableCamera());
        microphone = button("Microphone (temporarily disabled)"); root.addView(microphone); microphone.setVisibility(View.GONE); microphone.setOnClickListener(v -> enableMicrophone());
        status = new TextView(this); status.setText("Not paired"); root.addView(status); setContentView(root);
    }
    private EditText field(String hint) { EditText e = new EditText(this); e.setHint(hint); e.setPadding(0, 24, 0, 12); return e; }
    private Button button(String label) { Button b = new Button(this); b.setText(label); return b; }
    private boolean paired() { return prefs.contains("device_token") && prefs.contains("device_link_id"); }
    private void lockPairingUi() { start.setEnabled(true); request.setVisibility(View.GONE); verify.setVisibility(View.GONE); phone.setVisibility(View.GONE); otp.setVisibility(View.GONE); status.setText("This phone is already paired. Pairing cannot be disconnected from the phone. Tracking can be started again below."); }
    private String phoneValue() { String digits = phone.getText().toString().replaceAll("\\D", ""); if (digits.length() != 10) { status.setText("Enter exactly 10 digits."); return null; } return "+91" + digits; }
    private void requestOtp() { final String value = phoneValue(); if (value == null) return; status.setText("Sending OTP…"); try { JSONObject body = new JSONObject(); body.put("phone", value); post("/api/phone/request", body, result -> status.setText(result.optString("demoCode", "OTP sent. Check your phone."))); } catch (Exception e) { status.setText(e.getMessage()); } }
    private void verifyPairing() { if (verifyInProgress) return; final String value = phoneValue(); if (value == null) return; pendingPhoneValue = value; pendingOtpCode = otp.getText().toString().trim(); continuePermissionGate(); }
    private boolean mediaPermissionsReady() { return Build.VERSION.SDK_INT < 23 || (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED); }
    private boolean notificationPermissionReady() { return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED; }
    private boolean foregroundLocationReady() { return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED; }
    private boolean backgroundLocationReady() { return Build.VERSION.SDK_INT < 29 || checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED; }
    private void continuePermissionGate() { if (!notificationPermissionReady()) { status.setText("Allow notifications so tracking stays visible."); if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 28); return; } if (!foregroundLocationReady()) { status.setText("Allow location, then choose all-time/background access."); requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 26); return; } if (!backgroundLocationReady()) { status.setText("Choose Allow all the time for location to continue."); if (Build.VERSION.SDK_INT >= 29) requestPermissions(new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, 27); return; } completeVerifyPairing(); }
    private void completeVerifyPairing() { if (verifyInProgress || pendingPhoneValue == null || paired()) return; verifyInProgress = true; status.setText("Permissions allowed. Verifying device…"); try { JSONObject body = new JSONObject(); body.put("phone", pendingPhoneValue); body.put("code", pendingOtpCode); post("/api/phone/verify", body, result -> { verifyInProgress = false; prefs.edit().putString("device_token", result.getString("deviceToken")).putString("device_link_id", result.getString("deviceLinkId")).putBoolean("camera_permission_ready", false).putBoolean("mic_permission_ready", false).apply(); runOnUiThread(() -> { lockPairingUi(); status.setText("Paired permanently. Tracking is starting. Camera and microphone are disabled for now."); startTracking(); }); }); } catch (Exception e) { verifyInProgress = false; status.setText(e.getMessage()); } }
    private void requestLocationPermissions() { if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 20); if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 21); else if (Build.VERSION.SDK_INT >= 29 && checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, 22); }
    private boolean locationReady() { return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED; }
    private void startTracking() { if (!locationReady()) { requestLocationPermissions(); status.setText("Allow location permission, then tap Start again."); return; } if (Build.VERSION.SDK_INT >= 29 && checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) { requestPermissions(new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, 22); status.setText("Allow background location, then tap Start again."); return; } Intent i = new Intent(this, LocationService.class); if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i); status.setText("Tracking active. Keep the Veyra notification enabled."); moveTaskToBack(true); }
    private void enableCamera() { if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) { requestPermissions(new String[]{Manifest.permission.CAMERA}, 23); status.setText("Allow camera permission. The admin Camera button controls the camera."); return; } prefs.edit().putBoolean("camera_permission_ready", true).apply(); status.setText("Camera permission ready. The admin Camera button controls the front or back camera."); }
    private void enableMicrophone() { if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 24); status.setText("Allow microphone permission. The admin can then turn Mic on from the dashboard."); return; } prefs.edit().putBoolean("mic_permission_ready", true).apply(); status.setText("Microphone permission ready. The admin Mic button controls listening."); }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) { super.onRequestPermissionsResult(requestCode, permissions, results); if (requestCode == 25) { if (mediaPermissionsReady()) continuePermissionGate(); else { verifyInProgress = false; status.setText("Both camera and microphone permissions are required. Verification cancelled."); } } if (requestCode == 28) { if (notificationPermissionReady()) continuePermissionGate(); else { verifyInProgress = false; status.setText("Notification permission is required. Verification cancelled."); } } if (requestCode == 26) { if (foregroundLocationReady()) continuePermissionGate(); else { verifyInProgress = false; status.setText("Location permission is required. Verification cancelled."); } } if (requestCode == 27) { if (backgroundLocationReady()) continuePermissionGate(); else { verifyInProgress = false; status.setText("Choose Allow all the time for location. Verification cancelled."); } } if ((requestCode == 21 || requestCode == 22) && locationReady()) { status.setText("Location allowed. Starting background tracking…"); startTracking(); } if (requestCode == 23 && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) enableCamera(); if (requestCode == 24 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) enableMicrophone(); }
    private interface Result { void ok(JSONObject value) throws Exception; }
    private void post(String path, JSONObject body, Result callback) { io.execute(() -> { try { HttpURLConnection c = (HttpURLConnection)new URL(API + path).openConnection(); c.setRequestMethod("POST"); c.setRequestProperty("Content-Type", "application/json"); c.setDoOutput(true); try (OutputStream out = c.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); } int code = c.getResponseCode(); BufferedReader r = new BufferedReader(new InputStreamReader(code < 400 ? c.getInputStream() : c.getErrorStream())); StringBuilder text = new StringBuilder(); String line; while ((line = r.readLine()) != null) text.append(line); JSONObject result = new JSONObject(text.toString()); if (code >= 400) throw new Exception(result.optString("error", "Request failed")); runOnUiThread(() -> { try { callback.ok(result); } catch (Exception e) { status.setText(e.getMessage()); } }); } catch (Exception e) { runOnUiThread(() -> status.setText(e.getMessage())); } }); }
}
