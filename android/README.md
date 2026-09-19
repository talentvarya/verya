# Veyra Android tracker

This is the native tracker source for the Veyra vehicle device. It pairs a phone by OTP, stores the device token locally, and runs a visible Android foreground location service. The service resumes after a reboot when the device is still paired.

Build with Android Studio after installing Android SDK and Java 17:

```text
Open the android folder in Android Studio
Select Build > Build APK(s)
```

The API base URL is configured in `MainActivity.java` as the live Veyra Render URL. The device must be used with the vehicle owner's consent. Android will show a persistent `Veyra tracking active` notification while location sharing is running.
