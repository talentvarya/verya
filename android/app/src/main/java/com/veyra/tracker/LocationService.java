package com.veyra.tracker;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.IBinder;
import org.json.JSONObject;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LocationService extends Service implements LocationListener {
    private static final String CHANNEL = "veyra_tracking"; private LocationManager manager; private SharedPreferences prefs; private final ExecutorService io = Executors.newSingleThreadExecutor();
    @Override public void onCreate() { super.onCreate(); prefs = getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE); createChannel(); startForeground(7, notification()); if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) { manager = (LocationManager)getSystemService(LOCATION_SERVICE); manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 10000L, 10f, this); } }
    private void createChannel() { if (Build.VERSION.SDK_INT >= 26) ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL, "Veyra tracking", NotificationManager.IMPORTANCE_LOW)); }
    private Notification notification() { Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this); return b.setContentTitle("Veyra tracking active").setContentText("Location is being shared with the authorized Veyra dashboard").setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).build(); }
    @Override public void onLocationChanged(Location l) { try { JSONObject body = new JSONObject(); body.put("eventId", "ANDROID-" + System.currentTimeMillis()); body.put("deviceLinkId", prefs.getString("device_link_id", "")); body.put("lat", l.getLatitude()); body.put("lng", l.getLongitude()); body.put("accuracy", l.hasAccuracy() ? l.getAccuracy() : 20); body.put("speed", l.hasSpeed() ? l.getSpeed() * 3.6 : 0); body.put("source", "Veyra Android background GPS"); io.execute(() -> send(body)); } catch (Exception ignored) {} }
    private void send(JSONObject body) { try { HttpURLConnection c = (HttpURLConnection)new URL(MainActivity.API + "/api/ingest/position").openConnection(); c.setRequestMethod("POST"); c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("X-Device-Token", prefs.getString("device_token", "")); c.setDoOutput(true); try (OutputStream out = c.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); } if (c.getResponseCode() == 401 || c.getResponseCode() == 404) { stopSelf(); } } catch (Exception ignored) { /* next GPS update retries after connectivity returns */ } }
    @Override public void onProviderEnabled(String provider) {} @Override public void onProviderDisabled(String provider) {} @Override public void onStatusChanged(String provider, int status, android.os.Bundle extras) {}
    @Override public int onStartCommand(Intent intent, int flags, int startId) { return START_STICKY; }
    @Override public void onDestroy() { if (manager != null) manager.removeUpdates(this); io.shutdownNow(); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
