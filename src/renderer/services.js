// Desteklenen servis kataloğu
// icon: simpleicons.org slug'ı (yüklenemezse baş harf gösterilir)
window.VUNO_SERVICES = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    url: 'https://web.whatsapp.com/',
    color: '#25D366',
    gradient: 'linear-gradient(135deg, #25D366 0%, #128C7E 100%)',
    icon: 'whatsapp',
    description: 'QR kod ile telefonunu bağla'
  },
  {
    id: 'instagram',
    name: 'Instagram',
    url: 'https://www.instagram.com/direct/inbox/',
    color: '#E1306C',
    gradient: 'linear-gradient(135deg, #FEDA75 0%, #FA7E1E 25%, #D62976 50%, #962FBF 75%, #4F5BD5 100%)',
    icon: 'instagram',
    description: 'Direkt mesajlar'
  },
  {
    id: 'messenger',
    name: 'Messenger',
    url: 'https://www.facebook.com/messages/',
    color: '#0084FF',
    gradient: 'linear-gradient(135deg, #00B2FF 0%, #006AFF 50%, #A033FF 100%)',
    icon: 'messenger',
    description: 'Facebook mesajları'
  },
  {
    id: 'telegram',
    name: 'Telegram',
    url: 'https://web.telegram.org/a/',
    color: '#26A5E4',
    gradient: 'linear-gradient(135deg, #37BBFE 0%, #1E96C8 100%)',
    icon: 'telegram',
    description: 'Telefon numarası veya QR ile giriş'
  },
  {
    id: 'signal',
    name: 'Signal',
    url: null,
    color: '#3A76F0',
    gradient: 'linear-gradient(135deg, #3A76F0 0%, #2C5BC4 100%)',
    icon: 'signal',
    unavailable: true,
    description: 'Signal\'in web sürümü yok',
    note: 'Signal, güvenlik politikası gereği tarayıcı/web sürümü sunmuyor; bu yüzden diğer servisler gibi gömülemiyor. Bir sonraki sürümde resmi Signal protokolünü kullanan "signal-cli" köprüsü ile entegre edilmesi planlanıyor.'
  },
  {
    id: 'discord',
    name: 'Discord',
    url: 'https://discord.com/channels/@me',
    color: '#5865F2',
    gradient: 'linear-gradient(135deg, #7983F5 0%, #5865F2 100%)',
    icon: 'discord',
    description: 'Sunucular ve DM\'ler'
  },
  {
    id: 'x',
    name: 'X (Twitter)',
    url: 'https://x.com/messages',
    color: '#111111',
    gradient: 'linear-gradient(135deg, #2b2b2b 0%, #000000 100%)',
    icon: 'x',
    description: 'Direkt mesajlar'
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
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
    url: 'https://teams.microsoft.com/v2/',
    color: '#5B5FC7',
    gradient: 'linear-gradient(135deg, #7B83EB 0%, #5B5FC7 100%)',
    icon: null,
    letter: 'T',
    description: 'Sohbet ve toplantılar'
  }
];

window.getService = (id) => window.VUNO_SERVICES.find((s) => s.id === id);
