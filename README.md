# Vuno Messenger

<p align="center">
  <img src="assets/icon.png" alt="Vuno Messenger Logo" width="96" height="96" />
</p>

<p align="center">
  <b>Tüm mesajlaşma platformları tek bir şık ve güçlü masaüstü merkezinde.</b><br />
  WhatsApp, Instagram Direct, Facebook Messenger ve Telegram hesaplarınızı aynı anda yönetin, tek bir gelen kutusundan anında yanıtlayın.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-30+-47848F?logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/License-GPLv3-blue.svg" alt="License: GPL v3" />
  <img src="https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white" alt="Windows" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" />
</p>

---

## 🌟 Öne Çıkan Özellikler

### 📥 Birleşik Gelen Kutusu (Unified Inbox)
* Farklı platformlardan gelen tüm yeni mesajları tek bir akışta kronolojik olarak toplayın.
* Sekmeler arasında kaybolmadan gelen mesajları doğrudan akış içinden okuyun ve cevaplayın.
* Platform ve hesap filtreleri ile sadece ilgilendiğiniz iletişime odaklanın.

### 🌐 Ücretsiz Anlık & Tersine Çeviri
* **Gelen Mesajı Çevir:** Yabancı dilde gelen mesajları tek tıkla kendi dilinize çevirin.
* **Tersine Çevirerek Yanıtla:** Kendi dilinizde yazdığınız cevabı karşı tarafın diline (Lehçe, İngilizce, Almanca vb.) otomatik çevirip iletin.
* Google Translate ve MyMemory motorları üzerinden API anahtarı gerektirmeden ücretsiz çalışır.

### ✨ Yapay Zeka Destekli Akıllı Yanıtlar (Google Gemini)
* Mesaj içeriğini analiz eden dinamik akıllı yanıt önerileri.
* Uzun sohbet geçmişlerini tek tıkla özetleme.
* Yeni nesil `gemini-3.1-flash-lite` modeliyle ücretsiz kullanım desteği.

### 🛡️ Sıfır Ban Riski & İzolasyon Mimarisi
* Tersine mühendislik veya gayriresmi API kullanılmaz.
* Her servis resmi web istemcisiyle (`web.whatsapp.com`, `instagram.com` vb.) bağımsız Chromium partition'ları içinde çalışır.
* Aynı serviste (örn. 2 farklı WhatsApp veya 3 farklı Instagram hesabı) oturum çakışması olmadan çoklu hesap desteği.

### 🔒 Güvenlik, Gizlilik ve Performans
* **PIN Koruması:** `scrypt` ile şifrelenen yerel uygulama kilidi ve otomatik kilitlenme süresi.
* **Rahatsız Etme (DND):** Manuel veya saat aralıklı sessize alma modu.
* **Canlı Soket Desteği:** Arka plandaki servis bağlantıları koparılmaz; yeni bildirimler anında ekrana düşer.
* **Modern Koyu Arayüz:** Gözü yormayan cam efektli (glassmorphism) modern masaüstü deneyimi.

---

## 🚀 Başlarken

### Gereksinimler
* [Node.js](https://nodejs.org/) (v18 veya üzeri önerilir)
* npm veya yarn

### Kurulum

```bash
# Projeyi klonlayın
git clone https://github.com/edipbaranberk/Vuno-Messenger.git

# Proje dizinine geçin
cd Vuno-Messenger

# Bağımlılıkları yükleyin
npm install

# Geliştirme modunda başlatın
npm start
```

### Windows Kurulum Dosyası (Installer) Üretme

```bash
npm run dist
```
Çıktı dosyası `dist/` klasörü altına oluşturulacaktır.

---

## ⌨️ Klavye Kısayolları

| Kısayol | İşlev |
| :--- | :--- |
| **`Ctrl + 0`** | Birleşik Gelen Kutusu'na git |
| **`Ctrl + 1..9`** | Sırasıyla bağlı hesaplar arasında hızlı geçiş yap |
| **`Ctrl + K`** | Evrensel arama penceresini aç |
| **`Ctrl + R` / `F5`** | Uygulama arayüzünü yenile |
| **`Esc`** | Açık olan modalları kapat |

---

## 📂 Proje Mimarisi

```
Vuno-Messenger/
├── assets/                  # Uygulama ikonları ve görsel varlıklar
├── src/
│   ├── main/
│   │   ├── main.js          # Electron ana süreç, pencere, tepsi (tray) & IPC
│   │   └── store.js         # JSON tabanlı yerel ayar deposu
│   ├── preload/
│   │   ├── app-preload.js   # Ana arayüz güvenlik köprüsü
│   │   ├── webview-preload.js # Servis içi bildirim ve hızlı cevap yakalayıcı
│   │   └── popup-preload.js # Masaüstü bildirim kartı köprüsü
│   ├── popup/               # Ekranın sağ altındaki hızlı yanıt kartları
│   └── renderer/
│       ├── index.html       # Ana pencere iskeleti
│       ├── app.js           # Arayüz durumu, hesap yönetimi ve iş mantığı
│       ├── services.js      # Desteklenen platform tanımları
│       └── styles.css       # Tasarım sistemi ve tema stilleri
├── LICENSE                  # GNU General Public License v3.0
└── package.json
```

---

## 📜 Lisans

Bu proje **[GNU General Public License v3.0 (GPLv3)](LICENSE)** ile lisanslanmıştır.  
Detaylı bilgi için [LICENSE](LICENSE) dosyasını inceleyebilirsiniz.
