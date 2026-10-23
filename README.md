# Vuno Connect

<p align="center">
  <img src="assets/icon.png" alt="Vuno Connect Logo" width="100" height="100" />
</p>

<p align="center">
  <b>Tüm mesajlaşma ve e-posta platformlarınız tek bir şık, güvenli ve güçlü masaüstü merkezinde.</b><br />
  WhatsApp, Instagram, Messenger, Telegram, Discord, Gmail, Outlook, Proton Mail, Slack ve X hesaplarınızı aynı anda yönetin; iş ve kişisel iletişiminizi birbirinden ayırın.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-30+-47848F?logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white" alt="Windows" />
  <img src="https://img.shields.io/badge/License-GPLv3-blue.svg" alt="License: GPL v3" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" />
</p>

---

## 🌟 Öne Çıkan Özellikler

### 💬 Tek Merkezden Çoklu Platform Yönetimi
* **Mesajlaşma:** WhatsApp, Instagram Direct, Facebook Messenger, Telegram, Discord, Slack, X (Twitter).
* **E-Posta:** Gmail, Microsoft Outlook / Hotmail, Proton Mail.
* Tarayıcıda onlarca sekme arasında kaybolmadan tüm hesaplarınıza sol dockbar üzerinden tek tıkla erişin.

### 👥 Çoklu Hesap & Bağımsız Oturum İzolasyonu
* Aynı platformdan dilediğiniz kadar hesap ekleyin (örneğin 2 farklı WhatsApp veya 3 farklı Instagram hesabı).
* Her hesap tamamen izole Chromium oturumu (`partition: persist:vuno-...`) içinde çalışır; oturumlar, çerezler ve veriler asla birbirine karışmaz.
* Resmi web istemcileri doğrudan kullanıldığı için ban veya hesap kısıtlama riski yoktur.

### 🗂️ Çalışma Alanları (Kişisel & İş Ayrımı)
* **Kişisel** ve **İş** çalışma alanları ile odaklanmak istediğiniz alana göre filtreleme yapın.
* Hesapları tek tıkla iş veya kişisel gruplarına taşıyın.

### 🎨 Özel Logo & Simge Yükleme Desteği
* Kenar çubuğundaki (Dockbar) hesaplarınızın simgelerini tamamen kişiselleştirin.
* Bilgisayarınızdan dilediğiniz **PNG, JPG, SVG veya ICO** görselini yükleyin ya da hazır servis simgeleri arasından seçim yapın.
* Atadığınız özel simge hem sol menüde, hem aramada hem de masaüstü bildirimlerinde anında görüntülenir.

### 🔔 Akıllı Windows Masaüstü Bildirimleri
* Windows Bildirim Merkezi (Action Center) ile tam uyumlu yerel masaüstü bildirimleri.
* **Akıllı İkon Eşleme:** Bildirim kartında mesajı atan kişinin profil fotoğrafı (avatarı) veya ilgili servisin orijinal logosu gösterilir.
* Bildirime tıklandığında doğrudan ilgili hesaba geçiş yapılır.

### 🎭 Tema & Zengin Vurgu Rengi Paleti
* **Koyu / Açık Tema:** Sistem temanızla otomatik senkronize olan veya manuel seçilebilen modern arayüz.
* **Canlı Vurgu Renkleri:** Vuno Moru, Okyanus Mavisi, Zümrüt Yeşili, Gül Pembesi, Günbatımı, Alev Kırmızısı, Kozmik İndigo ve Kehribar seçenekleri.

### 🔒 Güvenlik & Yerel PIN Kilidi
* `scrypt` algoritmasıyla korunan yerel uygulama kilidi.
* Ayarlanabilir süreyle boşta kalındığında veya Windows kilitlendiğinde otomatik kilitlenme.
* Sıfır telemetri: Tüm hesap bilgileri yalnızca kendi bilgisayarınızda saklanır, harici hiçbir sunucuya veri iletilmez.

### ⚡ Sessize Alma & Rahatsız Etme (DND)
* Tek tıkla hesap bazında veya tüm uygulama genelinde bildirimleri ve sesleri sessize alma.
* Sistem tepsisi (System Tray) üzerinden arka planda sessizce çalışabilme.

---

## ⌨️ Klavye Kısayolları

| Kısayol | İşlev |
| :--- | :--- |
| **`Ctrl + 1..9`** | Bağlı hesaplar arasında anında geçiş yap |
| **`Ctrl + K`** | Evrensel arama penceresini aç (hesaplar ve servisler içinde ara) |
| **`Ctrl + R` / `F5`** | Aktif hesabı / uygulamayı yenile |
| **`Esc`** | Açık olan modalları ve pencereleri kapat |

---

## 🚀 Başlarken

### Gereksinimler
* [Node.js](https://nodejs.org/) (v18 veya üzeri önerilir)
* npm

### Kurulum

```bash
# Projeyi klonlayın
git clone https://github.com/edipbaranberk/Vuno-Connect.git

# Proje dizinine geçin
cd Vuno-Connect

# Bağımlılıkları yükleyin
npm install

# Geliştirme modunda başlatın
npm start
```

### Windows Kurulum Dosyası (Setup .exe) Üretme

```bash
npm run dist
```
Oluşturulan kurulum dosyası `dist/` klasörü altına kaydedilir (`Vuno-Connect-Setup-1.0.0.exe`).

---

## 📂 Proje Yapısı

```
Vuno-Connect/
├── assets/                  # Logo, tray ve servis PNG ikonları
│   ├── icon.ico             # Windows çoklu çözünürlüklü uygulama simgesi
│   ├── icon.png             # Uygulama logosu
│   ├── tray.png             # Sistem tepsisi simgesi
│   └── services/            # WhatsApp, Gmail, Outlook vb. yüksek çözünürlüklü simgeler
├── src/
│   ├── main/                # Electron ana süreç (Main Process)
│   │   ├── main.js          # Uygulama yaşam döngüsü & orkestrasyon
│   │   ├── windows.js       # Pencere yönetimi & simge bağlama
│   │   ├── security.js      # Oturum güvenliği, OAuth yönlendirmeleri & UA
│   │   ├── ipc.js           # Ana süreç - Arayüz IPC köprüleri
│   │   ├── notificationIcons.js # Bildirim simgeleri & avatar çözücü
│   │   ├── store.js         # Yerel veri ve ayar saklama
│   │   └── tray.js          # Sistem tepsisi yönetimi
│   ├── preload/             # Güvenli preload katmanları
│   └── renderer/            # Modern arayüz (HTML, CSS, JS)
│       ├── index.html       # Ana pencere & modallar
│       ├── styles.css       # Tasarım sistemi & renk temaları
│       ├── app.js           # Arayüz mantığı, dockbar & hesap yönetimi
│       └── services.js      # Desteklenen servis kataloğu
├── Baslat.bat               # Hızlı başlatıcı (CMD penceresi açmadan başlar)
├── Baslat.vbs               # Tamamen sessiz arka plan başlatıcısı
└── package.json             # Bağımlılıklar ve derleme yapılandırması
```

---

## 📄 Lisans

Bu proje [GPL-3.0](LICENSE) lisansı ile lisanslanmıştır.
