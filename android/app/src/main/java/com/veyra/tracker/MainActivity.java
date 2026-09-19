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
    private EditText phone, otp; private TextView status; private Button start, camera;
    private SharedPreferences prefs;

    @Override public void onCreate(Bundle state) { super.onCreate(state); prefs = getSharedPreferences(PREFS, MODE_PRIVATE); buildUi(); if (paired()) { start.setEnabled(true); camera.setEnabled(true); } }
    private void buildUi() {
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(32, 48, 32, 32);
        TextView title = new TextView(this); title.setText("Veyra Tracker\nMobile GPS device"); title.setTextSize(24); root.addView(title);
        TextView info = new TextView(this); info.setText("Pair this phone with your Veyra account. Location and camera sharing require permission and stay visible in Android notifications."); root.addView(info);
        phone = field("10-digit mobile number"); phone.setInputType(InputType.TYPE_CLASS_PHONE); phone.setFilters(new InputFilter[]{new InputFilter.LengthFilter(10)}); root.addView(phone);
        Button request = button("Send OTP"); root.addView(request); request.setOnClickListener(v -> requestOtp());
        otp = field("OTP code"); otp.setInputType(2); root.addView(otp);
        Button verify = button("Verify and pair"); root.addView(verify); verify.setOnClickListener(v -> verifyPairing());
        start = button("Start background tracking"); root.addView(start); start.setEnabled(false); start.setOnClickListener(v -> startTracking());
        camera = button("Enable vehicle camera"); root.addView(camera); camera.setEnabled(false); camera.setOnClickListener(v -> enableCamera());
        status = new TextView(this); status.setText("Not paired"); root.addView(status); setContentView(root);
    }
    private EditText field(String hint) { EditText e = new EditText(this); e.setHint(hint); e.setPadding(0, 24, 0, 12); return e; }
    private Button button(String label) { Button b = new Button(this); b.setText(label); return b; }
    private boolean paired() { return prefs.contains("device_token") && prefs.contains("device_link_id"); }
    private String phoneValue() { String digits = phone.getText().toString().replaceAll("\\D", ""); if (digits.length() != 10) { status.setText("Enter exactly 10 digits."); return null; } return "+91" + digits; }
    private void requestOtp() { final String value = phoneValue(); if (value == null) return; status.setText("Sending OTP…"); try { JSONObject body = new JSONObject(); body.put("phone", value); post("/api/phone/request", body, result -> status.setText(result.optString("demoCode", "OTP sent. Check your phone."))); } catch (Exception e) { status.setText(e.getMessage()); } }
    private void verifyPairing() { final String value = phoneValue(); if (value == null) return; status.setText("Pairing device…"); try { JSONObject body = new JSONObject(); body.put("phone", value); body.put("code", otp.getText().toString().trim()); post("/api/phone/verify", body, result -> { prefs.edit().putString("device_token", result.getString("deviceToken")).putString("device_link_id", result.getString("deviceLinkId")).apply(); runOnUiThread(() -> { start.setEnabled(true); camera.setEnabled(true); status.setText("Paired. Allow location, then start tracking."); requestLocationPermissions(); }); }); } catch (Exception e) { status.setText(e.getMessage()); } }
    private void requestLocationPermissions() { if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 20); if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 21); else if (Build.VERSION.SDK_INT >= 29 && checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, 22); }
    private boolean locationReady() { return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED; }
    private void startTracking() { if (!locationReady()) { requestLocationPermissions(); status.setText("Allow location permission, then tap Start again."); return; } if (Build.VERSION.SDK_INT >= 29 && checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) { requestPermissions(new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, 22); status.setText("Allow background location, then tap Start again."); return; } Intent i = new Intent(this, LocationService.class); if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i); status.setText("Tracking active. Keep the Veyra notification enabled."); moveTaskToBack(true); }
    private void enableCamera() { if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) { requestPermissions(new String[]{Manifest.permission.CAMERA}, 23); status.setText("Allow camera permission, then tap Enable vehicle camera again."); return; } Intent i = new Intent(this, LocationService.class).putExtra("enable_camera", true); if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i); status.setText("Camera active. A visible notification will remain on this phone."); }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) { super.onRequestPermissionsResult(requestCode, permissions, results); if ((requestCode == 21 || requestCode == 22) && locationReady()) { status.setText("Location allowed. Starting background tracking…"); startTracking(); } if (requestCode == 23 && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) enableCamera(); }
    private interface Result { void ok(JSONObject value) throws Exception; }
    private void post(String path, JSONObject body, Result callback) { io.execute(() -> { try { HttpURLConnection c = (HttpURLConnection)new URL(API + path).openConnection(); c.setRequestMethod("POST"); c.setRequestProperty("Content-Type", "application/json"); c.setDoOutput(true); try (OutputStream out = c.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); } int code = c.getResponseCode(); BufferedReader r = new BufferedReader(new InputStreamReader(code < 400 ? c.getInputStream() : c.getErrorStream())); StringBuilder text = new StringBuilder(); String line; while ((line = r.readLine()) != null) text.append(line); JSONObject result = new JSONObject(text.toString()); if (code >= 400) throw new Exception(result.optString("error", "Request failed")); runOnUiThread(() -> { try { callback.ok(result); } catch (Exception e) { status.setText(e.getMessage()); } }); } catch (Exception e) { runOnUiThread(() -> status.setText(e.getMessage())); } }); }
}
