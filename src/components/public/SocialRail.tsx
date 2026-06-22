/**
 * SocialRail — barra vertical de redes sociais fixada no lado esquerdo da
 * página. Aparece SÓ na versão web (lg+); no mobile fica oculta (o rodapé já
 * tem as redes). Ícones em círculo branco com a cor da marca.
 *
 * Links são genéricos por enquanto (perfis oficiais). Quando tiver os @ reais,
 * é só trocar os href aqui.
 */

type Social = {
  name: string;
  href: string;
  color: string;
  icon: React.ReactNode;
};

const SOCIALS: Social[] = [
  {
    name: 'Instagram',
    href: 'https://www.instagram.com/',
    color: '#E4405F',
    icon: (
      <path d="M12 2.2c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 01-1.38-.9 3.7 3.7 0 01-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.21 15.58 2.2 15.2 2.2 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.21 8.8 2.2 12 2.2zm0 1.8c-3.15 0-3.5.01-4.74.07-.9.04-1.39.19-1.71.32-.43.17-.74.37-1.06.69-.32.32-.52.63-.69 1.06-.13.32-.28.81-.32 1.71C3.21 8.5 3.2 8.85 3.2 12s.01 3.5.07 4.74c.04.9.19 1.39.32 1.71.17.43.37.74.69 1.06.32.32.63.52 1.06.69.32.13.81.28 1.71.32 1.24.06 1.59.07 4.74.07s3.5-.01 4.74-.07c.9-.04 1.39-.19 1.71-.32.43-.17.74-.37 1.06-.69.32-.32.52-.63.69-1.06.13-.32.28-.81.32-1.71.06-1.24.07-1.59.07-4.74s-.01-3.5-.07-4.74c-.04-.9-.19-1.39-.32-1.71a2.85 2.85 0 00-.69-1.06 2.85 2.85 0 00-1.06-.69c-.32-.13-.81-.28-1.71-.32C15.5 4.01 15.15 4 12 4zm0 3.06A4.94 4.94 0 1012 16.94 4.94 4.94 0 0012 7.06zm0 1.8a3.14 3.14 0 110 6.28 3.14 3.14 0 010-6.28zm5.14-.7a1.15 1.15 0 11-2.3 0 1.15 1.15 0 012.3 0z" />
    ),
  },
  {
    name: 'Facebook',
    href: 'https://www.facebook.com/',
    color: '#1877F2',
    icon: (
      <path d="M22 12a10 10 0 10-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0022 12z" />
    ),
  },
  {
    name: 'TikTok',
    href: 'https://www.tiktok.com/',
    color: '#111111',
    icon: (
      <path d="M16.5 3c.3 2.1 1.5 3.4 3.5 3.6v2.4c-1.2.1-2.3-.2-3.5-.9v6.1c0 3.1-2.3 5.3-5.2 5.3A5.1 5.1 0 016 14.4c0-3 2.5-5.2 5.6-4.9v2.5c-.4-.1-.9-.2-1.3-.1-1.3.1-2.2 1.1-2.1 2.5.1 1.3 1.1 2.2 2.4 2.1 1.3 0 2.2-1 2.2-2.5V3h2.7z" />
    ),
  },
  {
    name: 'YouTube',
    href: 'https://www.youtube.com/',
    color: '#FF0000',
    icon: (
      <path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 00.5 6.2 31 31 0 000 12a31 31 0 00.5 5.8 3 3 0 002.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 002.1-2.1A31 31 0 0024 12a31 31 0 00-.5-5.8zM9.6 15.6V8.4l6.4 3.6-6.4 3.6z" />
    ),
  },
];

export default function SocialRail() {
  return (
    <div className="fixed left-3 top-1/2 z-40 hidden -translate-y-1/2 flex-col gap-2.5 lg:flex">
      {SOCIALS.map((s) => (
        <a
          key={s.name}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={s.name}
          title={s.name}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 shadow-md ring-1 ring-black/5 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill={s.color} aria-hidden="true">
            {s.icon}
          </svg>
        </a>
      ))}
    </div>
  );
}
