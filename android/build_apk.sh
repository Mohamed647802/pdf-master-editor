#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/android-native"

echo "=== [1/4] Building Frontend Web Bundle (Vite) ==="
cd "$ROOT_DIR/frontend"
npm install --no-audit --no-fund
npm run build
test -f "$ROOT_DIR/frontend/dist/index.html"

echo "=== [2/4] Generating Native Android Gradle Project ==="
rm -rf "$BUILD_DIR"
mkdir -p \
  "$BUILD_DIR/app/src/main/java/org/pdfmaster/editor" \
  "$BUILD_DIR/app/src/main/assets/www" \
  "$BUILD_DIR/app/src/main/res/mipmap-mdpi" \
  "$BUILD_DIR/app/src/main/res/mipmap-hdpi" \
  "$BUILD_DIR/app/src/main/res/mipmap-xhdpi" \
  "$BUILD_DIR/app/src/main/res/mipmap-xxhdpi" \
  "$BUILD_DIR/app/src/main/res/mipmap-xxxhdpi" \
  "$BUILD_DIR/app/src/main/res/values" \
  "$BUILD_DIR/app/src/main/res/xml"

cp -r "$ROOT_DIR/frontend/dist/." "$BUILD_DIR/app/src/main/assets/www/"

for dir in mipmap-mdpi mipmap-hdpi mipmap-xhdpi mipmap-xxhdpi mipmap-xxxhdpi; do
  cp "$ROOT_DIR/android/assets/icon.png" "$BUILD_DIR/app/src/main/res/$dir/ic_launcher.png"
done

keytool -genkeypair -v \
  -keystore "$BUILD_DIR/app/release.keystore" \
  -alias pdfmaster \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass pdfmaster123 -keypass pdfmaster123 \
  -dname "CN=PDF Master, OU=Mobile, O=PDFMaster, L=Cairo, S=Cairo, C=EG"

cat << 'EOF' > "$BUILD_DIR/settings.gradle"
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "PDFMaster"
include ':app'
EOF

cat << 'EOF' > "$BUILD_DIR/build.gradle"
plugins {
    id 'com.android.application' version '8.3.2' apply false
}
EOF

cat << 'EOF' > "$BUILD_DIR/gradle.properties"
org.gradle.jvmargs=-Xmx3072m -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
EOF

cat << 'EOF' > "$BUILD_DIR/app/build.gradle"
plugins {
    id 'com.android.application'
}

android {
    namespace 'org.pdfmaster.editor'
    compileSdk 34

    defaultConfig {
        applicationId "org.pdfmaster.editor"
        minSdk 24
        targetSdk 34
        versionCode 2
        versionName "2.0.0"
    }

    signingConfigs {
        release {
            storeFile file("release.keystore")
            storePassword "pdfmaster123"
            keyAlias "pdfmaster"
            keyPassword "pdfmaster123"
            v1SigningEnabled true
            v2SigningEnabled true
        }
    }

    buildTypes {
        release {
            minifyEnabled false
            shrinkResources false
            signingConfig signingConfigs.release
        }
        debug {
            signingConfig signingConfigs.release
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }

    lint {
        checkReleaseBuilds false
        abortOnError false
    }
}

dependencies {
    implementation platform('org.jetbrains.kotlin:kotlin-bom:1.8.22')
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'androidx.webkit:webkit:1.10.0'
    implementation 'androidx.activity:activity:1.8.2'
    implementation 'androidx.core:core:1.12.0'
}
EOF

cat << 'EOF' > "$BUILD_DIR/app/src/main/res/values/styles.xml"
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.NoActionBar">
        <item name="android:statusBarColor">#0F0F1A</item>
        <item name="android:navigationBarColor">#0F0F1A</item>
        <item name="android:windowBackground">#0F0F1A</item>
    </style>
</resources>
EOF

cat << 'EOF' > "$BUILD_DIR/app/src/main/res/xml/file_paths.xml"
<?xml version="1.0" encoding="utf-8"?>
<paths>
    <cache-path name="shared" path="shared/" />
    <files-path name="files" path="." />
</paths>
EOF

cat << 'EOF' > "$BUILD_DIR/app/src/main/AndroidManifest.xml"
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />

    <application
        android:allowBackup="true"
        android:hardwareAccelerated="true"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher"
        android:label="PDF Master"
        android:supportsRtl="true"
        android:usesCleartextTraffic="true"
        android:theme="@style/AppTheme">

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|screenLayout|keyboardHidden|uiMode">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
EOF

cat << 'EOF' > "$BUILD_DIR/app/src/main/java/org/pdfmaster/editor/MainActivity.java"
package org.pdfmaster.editor;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    private final ActivityResultLauncher<Intent> fileChooserLauncher =
        registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (filePathCallback == null) return;
            Uri[] uris = null;
            Intent data = result.getData();
            if (result.getResultCode() == Activity.RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    uris = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        uris[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    uris = new Uri[]{ data.getData() };
                }
            }
            filePathCallback.onReceiveValue(uris);
            filePathCallback = null;
        });

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0F0F1A"));

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        ws.setBuiltInZoomControls(false);
        ws.setDisplayZoomControls(false);
        ws.setMediaPlaybackRequiresUserGesture(false);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;

                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");

                String[] acceptTypes = params.getAcceptTypes();
                if (acceptTypes != null && acceptTypes.length > 0 && acceptTypes[0] != null) {
                    String accept = acceptTypes[0].toLowerCase();
                    if (accept.contains("pdf")) {
                        intent.setType("application/pdf");
                    } else if (accept.contains("image")) {
                        intent.setType("image/*");
                    }
                }
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }

                try {
                    fileChooserLauncher.launch(Intent.createChooser(intent, "Select File"));
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        setContentView(webView);
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    public class AndroidBridge {
        @JavascriptInterface
        public boolean saveBase64File(String base64Data, String fileName, String mimeType) {
            try {
                int comma = base64Data.indexOf(',');
                String clean = comma >= 0 ? base64Data.substring(comma + 1) : base64Data;
                byte[] bytes = Base64.decode(clean, Base64.DEFAULT);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                    values.put(MediaStore.Downloads.MIME_TYPE, mimeType != null ? mimeType : "application/octet-stream");
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/PDFMaster");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                            if (os != null) os.write(bytes);
                        }
                    }
                } else {
                    File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    if (!dir.exists()) dir.mkdirs();
                    File outFile = new File(dir, fileName);
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        fos.write(bytes);
                    }
                }

                runOnUiThread(() -> Toast.makeText(
                    MainActivity.this,
                    "✅ Saved to Downloads/PDFMaster/" + fileName,
                    Toast.LENGTH_LONG
                ).show());
                return true;
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(
                    MainActivity.this,
                    "❌ Save error: " + e.getMessage(),
                    Toast.LENGTH_LONG
                ).show());
                return false;
            }
        }

        @JavascriptInterface
        public void shareBase64File(String base64Data, String fileName, String mimeType) {
            try {
                int comma = base64Data.indexOf(',');
                String clean = comma >= 0 ? base64Data.substring(comma + 1) : base64Data;
                byte[] bytes = Base64.decode(clean, Base64.DEFAULT);
                File shareDir = new File(getCacheDir(), "shared");
                if (!shareDir.exists()) shareDir.mkdirs();
                File file = new File(shareDir, fileName);
                try (FileOutputStream fos = new FileOutputStream(file)) {
                    fos.write(bytes);
                }
                Uri uri = FileProvider.getUriForFile(
                    MainActivity.this,
                    getPackageName() + ".fileprovider",
                    file
                );
                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType(mimeType != null ? mimeType : "application/pdf");
                shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(shareIntent, "Share " + fileName));
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(
                    MainActivity.this,
                    "❌ Share error: " + e.getMessage(),
                    Toast.LENGTH_LONG
                ).show());
            }
        }
    }
}
EOF

echo "=== [3/4] Setting up Android SDK 34 & Gradle 8.7 ==="
SDK_MGR=""
if [ -x "${ANDROID_HOME:-}/cmdline-tools/latest/bin/sdkmanager" ]; then
  SDK_MGR="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
elif [ -x "${ANDROID_SDK_ROOT:-}/cmdline-tools/latest/bin/sdkmanager" ]; then
  SDK_MGR="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/sdkmanager"
fi

if [ -n "$SDK_MGR" ]; then
  yes | "$SDK_MGR" --licenses >/dev/null 2>&1 || true
  "$SDK_MGR" "platforms;android-34" "build-tools;34.0.0"
fi

GRADLE_VERSION="8.7"
if [ ! -x "/tmp/gradle-${GRADLE_VERSION}/bin/gradle" ]; then
  curl -fsSL "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" -o /tmp/gradle.zip
  unzip -q -o /tmp/gradle.zip -d /tmp
fi
export PATH="/tmp/gradle-${GRADLE_VERSION}/bin:$PATH"

echo "=== [4/4] Compiling Signed Release APK ==="
cd "$BUILD_DIR"
gradle assembleRelease --no-daemon --stacktrace

mkdir -p "$ROOT_DIR/android/bin"
APK_OUT="$(find "$BUILD_DIR/app/build/outputs/apk/release" -name "*.apk" | head -n 1)"
if [ -z "$APK_OUT" ] || [ ! -f "$APK_OUT" ]; then
  echo "ERROR: APK was not generated!"
  exit 1
fi

cp "$APK_OUT" "$ROOT_DIR/android/bin/PDFMaster.apk"
ls -lh "$ROOT_DIR/android/bin/PDFMaster.apk"
echo "✅ SUCCESS: APK ready at $ROOT_DIR/android/bin/PDFMaster.apk"
