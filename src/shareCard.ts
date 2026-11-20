import { avatarUrl } from './Avatar';

/** The person or group on the card: their photo, or initials on their tone. */
export type CardFace = { photo?: string | null; tone: number };

const loadImage = async (src: string) => {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
};
const cssValue = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const initials = (title: string) =>
  title
    .split(/\s+/)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'G';
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The share card as a picture (1080 × 1350): the accent as a lit background, a white card with
 * the photo on its top edge, the name, the @login and the code, and the Galinka mark at the foot.
 * The share sheet shows this very picture, so what is saved or sent is exactly what was seen.
 */
export async function renderShareCard({
  qr,
  title,
  subtitle,
  accent,
  face,
  withPhoto = true,
}: {
  qr: SVGSVGElement;
  title: string;
  subtitle: string;
  accent: string;
  face?: CardFace;
  /** False draws initials instead of the photo (a photo from another server taints the canvas). */
  withPhoto?: boolean;
}) {
  const width = 1080,
    height = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw Error('Canvas unavailable');
  const font = getComputedStyle(document.body).fontFamily;
  await Promise.all(
    ['400 40px', '600 60px'].map((weight) => document.fonts?.load(`${weight} ${font}`)),
  ).catch(() => {});

  // Background: the accent, lit from the top left and darker towards the bottom right.
  context.fillStyle = accent;
  context.fillRect(0, 0, width, height);
  const dark = context.createLinearGradient(0, 0, width, height);
  dark.addColorStop(0, 'rgba(0,0,0,0)');
  dark.addColorStop(1, 'rgba(0,0,0,0.38)');
  context.fillStyle = dark;
  context.fillRect(0, 0, width, height);
  const light = context.createRadialGradient(240, 120, 0, 240, 120, 900);
  light.addColorStop(0, 'rgba(255,255,255,0.28)');
  light.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = light;
  context.fillRect(0, 0, width, height);

  // The card.
  const card = { x: 90, y: 230, width: 900, height: 960 };
  context.save();
  context.shadowColor = 'rgba(0,0,0,0.22)';
  context.shadowBlur = 60;
  context.shadowOffsetY = 20;
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.roundRect(card.x, card.y, card.width, card.height, 64);
  context.fill();
  context.restore();

  // The face on the card's top edge, in a white ring.
  const center = { x: width / 2, y: card.y };
  const radius = 108;
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.arc(center.x, center.y, radius + 14, 0, Math.PI * 2);
  context.fill();
  context.save();
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.clip();
  const tone = (face?.tone ?? 0) % 6;
  let drew = false;
  if (face?.photo && withPhoto)
    try {
      const picture = await loadImage(avatarUrl(face.photo));
      context.drawImage(picture, center.x - radius, center.y - radius, radius * 2, radius * 2);
      drew = true;
    } catch {
      /* No photo: the initials below. */
    }
  if (!drew) {
    context.fillStyle = face ? cssValue(`--tone-${tone}-bg`, '#f2ddd7') : accent;
    context.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
    context.fillStyle = face ? cssValue(`--tone-${tone}-ink`, '#9a2f27') : '#ffffff';
    context.font = `600 84px ${font}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(initials(title), center.x, center.y + 4);
  }
  context.restore();

  // Name and @login.
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#19191a';
  context.font = `600 60px ${font}`;
  context.fillText(clip(title, 26), width / 2, card.y + 190);
  context.fillStyle = '#6c6b70';
  context.font = `400 40px ${font}`;
  context.fillText(clip(subtitle, 40), width / 2, card.y + 250);

  // The code.
  const code = await loadImage(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(qr))}`,
  );
  context.drawImage(code, (width - 620) / 2, card.y + 300, 620, 620);

  // The mark under the card.
  context.fillStyle = '#ffffff';
  context.font = `600 48px ${font}`;
  context.fillText('Galinka', width / 2, 1270);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw Error('Card encoding failed');
  return { blob, data: canvas.toDataURL('image/png') };
}
