import { jsx, jsxs } from "react/jsx-runtime";
import { resolveImageUrl, RobustImg } from "./images";
const HEADER_PHOTO_LINK = "https://drive.google.com/file/d/17_Wt5nHtKbuDc7DiynDexI-l-GY8RpgS/view?usp=sharing";
const SIGNATURE_LINKS = [
  "https://drive.google.com/file/d/1KnoE8uWAwugB0PRMiPmq32eCW-ZxMasj/view?usp=drive_link",
  "https://drive.google.com/file/d/1XSSbL_JtTqYNwxJ_xquwQj5c5daeMm1V/view?usp=drive_link"
];
const headerPhotoSrc = resolveImageUrl(HEADER_PHOTO_LINK, 900);
const signatureSrcs = SIGNATURE_LINKS.map((l) => resolveImageUrl(l, 700));
function LoveStoryHeader() {
  return /* @__PURE__ */ jsxs("div", { className: "ls-header", children: [
    /* @__PURE__ */ jsx("div", { className: "ls-header-photo", children: /* @__PURE__ */ jsx(RobustImg, { src: HEADER_PHOTO_LINK, widthHint: 900, alt: "us", draggable: false }) }),
    /* @__PURE__ */ jsxs("div", { className: "ls-header-text", children: [
      /* @__PURE__ */ jsx("h1", { className: "ls-title", children: "\u{1F495} OUR LOVE STORY \u{1F495}" }),
      /* @__PURE__ */ jsxs("p", { className: "ls-sub", children: [
        "\u{1F36F}\u{1FAF0}\u{1FAF6}\u{1F3FB} Chota Don\u2763\uFE0F\u2764\uFE0F\u{1F618} & Shinu \u{1F48F}\u{1F444}\u{1FAE6}",
        " ",
        /* @__PURE__ */ jsx("span", { className: "ls-dash", children: "----" }),
        " \u2728Two Bodies, One Soul\u2728"
      ] }),
      /* @__PURE__ */ jsxs("p", { className: "ls-meta", children: [
        "Started: 16th December 2025\u23F010:19 AM (UAE)",
        " ",
        /* @__PURE__ */ jsx("span", { className: "ls-dash", children: "----" }),
        " \u{1F319}Dubai\u2708\uFE0F \u{1F54C} Nadiad \u{1F33A}"
      ] }),
      /* @__PURE__ */ jsx("p", { className: "ls-quote", children: "This distance is painful\u2026 but it's also proof\u2014that what we have is real." })
    ] })
  ] });
}
function LoveStoryFooter() {
  return /* @__PURE__ */ jsxs("div", { className: "ls-footer", children: [
    /* @__PURE__ */ jsx("div", { className: "ls-sign", children: /* @__PURE__ */ jsx(RobustImg, { src: SIGNATURE_LINKS[0], widthHint: 700, alt: "signature", draggable: false }) }),
    /* @__PURE__ */ jsx("div", { className: "ls-sign", children: /* @__PURE__ */ jsx(RobustImg, { src: SIGNATURE_LINKS[1], widthHint: 700, alt: "signature", draggable: false }) })
  ] });
}
export {
  HEADER_PHOTO_LINK,
  LoveStoryFooter,
  LoveStoryHeader,
  SIGNATURE_LINKS,
  headerPhotoSrc,
  signatureSrcs
};
