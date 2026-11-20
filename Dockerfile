# =========================================================
# YowisBen Bot Controller — image siap build APK Flutter
# Node 20 + Flutter 3.24 + Android SDK 34 + JDK 17 + yt-dlp + ffmpeg
# =========================================================
FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive

# --- paket dasar ---
RUN apt-get update && apt-get install -y --no-install-recommends \
      openjdk-17-jdk-headless unzip xz-utils ffmpeg python3 python3-pip \
      curl git ca-certificates file \
    && rm -rf /var/lib/apt/lists/*

# --- Android SDK (cmdline-tools + platform 34 + build-tools) ---
ENV ANDROID_HOME=/opt/android-sdk
RUN mkdir -p ${ANDROID_HOME}/cmdline-tools \
 && curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o /tmp/clt.zip \
 && unzip -q /tmp/clt.zip -d ${ANDROID_HOME}/cmdline-tools \
 && mv ${ANDROID_HOME}/cmdline-tools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest \
 && rm /tmp/clt.zip
ENV PATH=${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}
RUN yes | sdkmanager --licenses >/dev/null \
 && sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" >/dev/null

# --- Flutter SDK (stable 3.24.x) ---
ENV FLUTTER_HOME=/opt/flutter
RUN git clone --depth 1 -b 3.24.3 https://github.com/flutter/flutter.git ${FLUTTER_HOME} \
 && ${FLUTTER_HOME}/bin/flutter --version \
 && ${FLUTTER_HOME}/bin/flutter config --no-analytics
ENV PATH=${FLUTTER_HOME}/bin:${PATH}
RUN yes | flutter doctor --android-licenses >/dev/null

# --- yt-dlp untuk download video semua sosmed ---
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

# --- aplikasi ---
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .

ENV HOME=/tmp
EXPOSE 3000
CMD ["node", "src/index.js"]
