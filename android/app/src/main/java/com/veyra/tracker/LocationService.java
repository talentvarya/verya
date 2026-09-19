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
import android.graphics.ImageFormat;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.media.Image;
import android.media.ImageReader;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Size;
import org.json.JSONObject;
import java.nio.ByteBuffer;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LocationService extends Service implements LocationListener {
    private static final String CHANNEL = "veyra_tracking"; private LocationManager manager; private SharedPreferences prefs; private final ExecutorService io = Executors.newSingleThreadExecutor(); private CameraDevice camera; private CameraCaptureSession cameraSession; private ImageReader imageReader; private HandlerThread cameraThread; private Handler cameraHandler; private boolean cameraEnabled; private long lastCameraUpload;
    @Override public void onCreate() { super.onCreate(); prefs = getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE); createChannel(); startForeground(7, notification()); if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) { manager = (LocationManager)getSystemService(LOCATION_SERVICE); try { if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 10000L, 10f, this); } catch (Exception ignored) {} try { if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 10000L, 10f, this); } catch (Exception ignored) {} } }
    private void createChannel() { if (Build.VERSION.SDK_INT >= 26) ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL, "Veyra tracking", NotificationManager.IMPORTANCE_LOW)); }
    private Notification notification() { Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this); return b.setContentTitle("Veyra tracking active").setContentText(cameraEnabled ? "Location and camera are shared with the authorized Veyra dashboard" : "Location is being shared with the authorized Veyra dashboard").setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).build(); }
    @Override public void onLocationChanged(Location l) { try { JSONObject body = new JSONObject(); body.put("eventId", "ANDROID-" + System.currentTimeMillis()); body.put("deviceLinkId", prefs.getString("device_link_id", "")); body.put("lat", l.getLatitude()); body.put("lng", l.getLongitude()); body.put("accuracy", l.hasAccuracy() ? l.getAccuracy() : 20); body.put("speed", l.hasSpeed() ? l.getSpeed() * 3.6 : 0); body.put("source", "Veyra Android background GPS"); io.execute(() -> send(body)); } catch (Exception ignored) {} }
    private void send(JSONObject body) { try { HttpURLConnection c = (HttpURLConnection)new URL(MainActivity.API + "/api/ingest/position").openConnection(); c.setRequestMethod("POST"); c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("X-Device-Token", prefs.getString("device_token", "")); c.setDoOutput(true); try (OutputStream out = c.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); } if (c.getResponseCode() == 401 || c.getResponseCode() == 404) { stopSelf(); } } catch (Exception ignored) { /* next GPS update retries after connectivity returns */ } }
    private void enableCamera() { if (camera != null || checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return; cameraEnabled = true; ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(7, notification()); cameraThread = new HandlerThread("VeyraCamera"); cameraThread.start(); cameraHandler = new Handler(cameraThread.getLooper()); try { CameraManager cameras = (CameraManager)getSystemService(CAMERA_SERVICE); String selected = null; for (String id : cameras.getCameraIdList()) { CameraCharacteristics info = cameras.getCameraCharacteristics(id); Integer facing = info.get(CameraCharacteristics.LENS_FACING); if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) { selected = id; break; } } if (selected == null) return; String cameraId = selected; if (Build.VERSION.SDK_INT >= 23) cameras.openCamera(cameraId, new CameraDevice.StateCallback() { @Override public void onOpened(CameraDevice device) { camera = device; startCameraCapture(); } @Override public void onDisconnected(CameraDevice device) { device.close(); camera = null; } @Override public void onError(CameraDevice device, int error) { device.close(); camera = null; } }, cameraHandler); } catch (Exception ignored) {} }
    private void startCameraCapture() { try { imageReader = ImageReader.newInstance(640, 480, ImageFormat.JPEG, 2); imageReader.setOnImageAvailableListener(reader -> { Image image = reader.acquireLatestImage(); if (image == null) return; ByteBuffer buffer = image.getPlanes()[0].getBuffer(); byte[] bytes = new byte[buffer.remaining()]; buffer.get(bytes); image.close(); long now = System.currentTimeMillis(); if (now - lastCameraUpload < 4000L) return; lastCameraUpload = now; io.execute(() -> sendCamera(bytes)); }, cameraHandler); camera.createCaptureSession(Arrays.asList(imageReader.getSurface()), new CameraCaptureSession.StateCallback() { @Override public void onConfigured(CameraCaptureSession session) { cameraSession = session; try { CaptureRequest.Builder request = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW); request.addTarget(imageReader.getSurface()); request.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO); session.setRepeatingRequest(request.build(), null, cameraHandler); } catch (Exception ignored) {} } @Override public void onConfigureFailed(CameraCaptureSession session) {} }, cameraHandler); } catch (Exception ignored) {} }
    private void sendCamera(byte[] bytes) { try { JSONObject body = new JSONObject(); body.put("deviceLinkId", prefs.getString("device_link_id", "")); body.put("image", Base64.getEncoder().encodeToString(bytes)); HttpURLConnection c = (HttpURLConnection)new URL(MainActivity.API + "/api/ingest/camera").openConnection(); c.setRequestMethod("POST"); c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("X-Device-Token", prefs.getString("device_token", "")); c.setDoOutput(true); try (OutputStream out = c.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); } if (c.getResponseCode() == 401 || c.getResponseCode() == 404) stopCamera(); } catch (Exception ignored) {} }
    private void stopCamera() { if (cameraSession != null) { try { cameraSession.close(); } catch (Exception ignored) {} cameraSession = null; } if (camera != null) { try { camera.close(); } catch (Exception ignored) {} camera = null; } }
    @Override public void onProviderEnabled(String provider) {} @Override public void onProviderDisabled(String provider) {} @Override public void onStatusChanged(String provider, int status, android.os.Bundle extras) {}
    @Override public int onStartCommand(Intent intent, int flags, int startId) { if (intent != null && intent.getBooleanExtra("enable_camera", false)) enableCamera(); return START_STICKY; }
    @Override public void onDestroy() { if (manager != null) manager.removeUpdates(this); stopCamera(); if (imageReader != null) imageReader.close(); if (cameraThread != null) cameraThread.quitSafely(); io.shutdownNow(); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
