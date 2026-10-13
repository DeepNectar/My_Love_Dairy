// 💕 OUR LOVE STORY — fixed page header & footer (site + PDF), plus the
// Google Drive links the user supplied. Everything is rendered at true A4
// content width with narrow margins so the on-screen sheet and the exported
// PDF are pixel-identical.
import { resolveImageUrl } from './images';

/** Drive link → photo shown in the top-left corner of the header on every page. */
export const HEADER_PHOTO_LINK =
  'https://drive.google.com/file/d/17_Wt5nHtKbuDc7DiynDexI-l-GY8RpgS/view?usp=sharing';

/** Drive links → both signatures, side by side in the footer of every page. */
export const SIGNATURE_LINKS = [
  'https://drive.google.com/file/d/1KnoE8uWAwugB0PRMiPmq32eCW-ZxMasj/view?usp=drive_link',
  'https://drive.google.com/file/d/1XSSbL_JtTqYNwxJ_xquwQj5c5daeMm1V/view?usp=drive_link',
];

export const headerPhotoSrc = resolveImageUrl(HEADER_PHOTO_LINK, 900);
export const signatureSrcs = SIGNATURE_LINKS.map((l) => resolveImageUrl(l, 700));

/** Header band — photo pinned to the LEFT corner, title block beside it. */
export function LoveStoryHeader() {
  return (
    <div className="ls-header">
      <div className="ls-header-photo">
        <img src={headerPhotoSrc} alt="us" crossOrigin="anonymous" draggable={false} />
      </div>
      <div className="ls-header-text">
        <h1 className="ls-title">💕 OUR LOVE STORY 💕</h1>
        <p className="ls-sub">
          🍯🫰🫶🏻 Chota Don❣️❤️😘 &amp; Shinu 💏👄🫦{' '}
          <span className="ls-dash">----</span> ✨Two Bodies, One Soul✨
        </p>
        <p className="ls-meta">
          Started: 16th December 2025⏰10:19 AM (UAE){' '}
          <span className="ls-dash">----</span> 🌙Dubai✈️ 🕌 Nadiad 🌺
        </p>
        <p className="ls-quote">
          This distance is painful… but it&apos;s also proof—that what we have is real.
        </p>
      </div>
    </div>
  );
}

/** Footer band — both signatures, one per side. */
export function LoveStoryFooter() {
  return (
    <div className="ls-footer">
      <div className="ls-sign">
        <img src={signatureSrcs[0]} alt="signature" crossOrigin="anonymous" draggable={false} />
      </div>
      <div className="ls-sign">
        <img src={signatureSrcs[1]} alt="signature" crossOrigin="anonymous" draggable={false} />
      </div>
    </div>
  );
}
