// Desteklenen servis kataloğu
// category: 'messaging' | 'email'
// icon: simpleicons.org slug'ı (yüklenemezse baş harf / letter gösterilir)
window.VUNO_SERVICES = [
  // ---------- Mesajlaşma Platformları ----------
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    category: 'messaging',
    url: 'https://web.whatsapp.com/',
    color: '#25D366',
    gradient: 'linear-gradient(135deg, #25D366 0%, #128C7E 100%)',
    icon: 'whatsapp',
    description: 'QR kod ile telefonunu bağla'
  },
  {
    id: 'instagram',
    name: 'Instagram',
    category: 'messaging',
    url: 'https://www.instagram.com/direct/inbox/',
    color: '#E1306C',
    gradient: 'linear-gradient(135deg, #FEDA75 0%, #FA7E1E 25%, #D62976 50%, #962FBF 75%, #4F5BD5 100%)',
    icon: 'instagram',
    description: 'Direkt mesajlar'
  },
  {
    id: 'messenger',
    name: 'Messenger',
    category: 'messaging',
    url: 'https://www.facebook.com/messages/',
    color: '#0084FF',
    gradient: 'linear-gradient(135deg, #00B2FF 0%, #006AFF 50%, #A033FF 100%)',
    icon: 'messenger',
    description: 'Facebook mesajları'
  },
  {
    id: 'telegram',
    name: 'Telegram',
    category: 'messaging',
    url: 'https://web.telegram.org/a/',
    color: '#26A5E4',
    gradient: 'linear-gradient(135deg, #37BBFE 0%, #1E96C8 100%)',
    icon: 'telegram',
    description: 'Telefon numarası veya QR ile giriş'
  },
  {
    id: 'discord',
    name: 'Discord',
    category: 'messaging',
    url: 'https://discord.com/channels/@me',
    color: '#5865F2',
    gradient: 'linear-gradient(135deg, #7983F5 0%, #5865F2 100%)',
    icon: 'discord',
    description: 'Sunucular ve DM\'ler'
  },
  {
    id: 'x',
    name: 'X (Twitter)',
    category: 'messaging',
    url: 'https://x.com/messages',
    color: '#111111',
    gradient: 'linear-gradient(135deg, #2b2b2b 0%, #000000 100%)',
    icon: 'x',
    description: 'Direkt mesajlar'
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    category: 'messaging',
    url: 'https://www.linkedin.com/messaging/',
    color: '#0A66C2',
    gradient: 'linear-gradient(135deg, #2D8CE6 0%, #0A66C2 100%)',
    icon: null,
    letter: 'in',
    description: 'Profesyonel mesajlar'
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'messaging',
    url: 'https://app.slack.com/client',
    color: '#4A154B',
    gradient: 'linear-gradient(135deg, #611f69 0%, #4A154B 100%)',
    icon: null,
    letter: 'S',
    description: 'Çalışma alanları'
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    category: 'messaging',
    url: 'https://teams.microsoft.com/v2/',
    color: '#5B5FC7',
    gradient: 'linear-gradient(135deg, #7B83EB 0%, #5B5FC7 100%)',
    icon: null,
    letter: 'T',
    description: 'Sohbet ve toplantılar'
  },
  {
    id: 'signal',
    name: 'Signal',
    category: 'messaging',
    url: null,
    color: '#3A76F0',
    gradient: 'linear-gradient(135deg, #3A76F0 0%, #2C5BC4 100%)',
    icon: 'signal',
    unavailable: true,
    description: 'Signal\'in web sürümü yok',
    note: 'Signal, güvenlik politikası gereği tarayıcı/web sürümü sunmuyor; bu yüzden diğer servisler gibi gömülemiyor. Bir sonraki sürümde resmi Signal protokolünü kullanan "signal-cli" köprüsü ile entegre edilmesi planlanıyor.'
  },

  // ---------- E-Posta Servisleri ----------
  {
    id: 'gmail',
    name: 'Gmail',
    category: 'email',
    url: 'https://accounts.google.com/ServiceLogin?service=mail&continue=https://mail.google.com/mail/u/0/',
    color: '#EA4335',
    gradient: 'linear-gradient(135deg, #EA4335 0%, #D93025 50%, #B31412 100%)',
    icon: 'gmail',
    letter: 'M',
    description: 'Google e-postaları'
  },
  {
    id: 'outlook',
    name: 'Outlook',
    category: 'email',
    url: 'https://outlook.live.com/mail/0/',
    color: '#0078D4',
    gradient: 'linear-gradient(135deg, #0078D4 0%, #005A9E 100%)',
    icon: 'microsoftoutlook',
    letter: 'O',
    description: 'Microsoft Outlook & Hotmail'
  },
  {
    id: 'proton',
    name: 'Proton Mail',
    category: 'email',
    url: 'https://mail.proton.me/',
    color: '#6D4AFF',
    gradient: 'linear-gradient(135deg, #6D4AFF 0%, #5122F5 100%)',
    icon: 'proton',
    letter: 'P',
    description: 'Uçtan uca şifreli güvenli e-posta'
  },
  {
    id: 'yandex',
    name: 'Yandex Mail',
    category: 'email',
    url: 'https://mail.yandex.com/',
    color: '#FC3F1D',
    gradient: 'linear-gradient(135deg, #FC3F1D 0%, #E62E05 100%)',
    icon: 'yandex',
    letter: 'Y',
    description: 'Yandex e-postaları'
  }
];

window.getService = (id) => window.VUNO_SERVICES.find((s) => s.id === id);
