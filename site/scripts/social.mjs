// Vite plugin: writes each public page's title, description, Open Graph and Twitter tags into its HTML, because
// social networks read the HTML without running JavaScript. They need absolute URLs, unlike the rest of the build.
// Their text is in English, the site's default language. docs/brand/social.html is the source of social.png.
import en from "../src/lib/i18n/en.js";

const SITE = "https://artpow.org";
const IMAGE = {
  url: `${SITE}/social.png`,
  width: 1200,
  height: 630,
  alt: "ArtPoW: a new artwork every month, mined, not bought",
};

// Path on the site, key of the title in the translations, description.
const PAGES = {
  index: ["", "title.home", "A free NFT every month, earned by proof of work: mine it in your browser, with no price, no whitelist and no royalties."],
  how: ["how", "title.how", "How ArtPoW works: mining in the browser, the difficulty curve and the rules of each monthly edition, with examples."],
  mine: ["mine", "title.mine", "Mine this month's ArtPoW edition in your browser. It is free, and no POL is needed: the relay can pay the gas."],
  gallery: ["gallery", "title.gallery", "Browse every ArtPoW edition and each token mined so far."],
  stats: ["stats", "title.stats", "ArtPoW statistics: tokens mined, difficulty and activity for each monthly edition."],
  whitepaper: ["whitepaper", "title.whitepaper", "The ArtPoW whitepaper: the proof of work, the difficulty curve and the design of the contract."],
  artists: ["artists", "title.artists", "Show your work in ArtPoW: how artists take part in a monthly edition, and the No AI charter."],
  contact: ["contact", "title.contact", "Contact the ArtPoW project."],
  legal: ["legal", "title.legal", "Legal notice of the ArtPoW website."],
  privacy: ["privacy", "title.privacy", "What the ArtPoW website does with your data, and the services it relies on."],
};

function tags([path, titleKey, description]) {
  const title = en[titleKey];
  const url = `${SITE}/${path}`;
  const meta = (attr, name, content) => `    <meta ${attr}="${name}" content="${content}" />`;
  const og = (name, content) => meta("property", `og:${name}`, content);
  const twitter = (name, content) => meta("name", `twitter:${name}`, content);
  return {
    title,
    description,
    social: [
      og("type", "website"),
      og("site_name", "ArtPoW"),
      og("locale", "en_US"),
      og("title", title),
      og("description", description),
      og("url", url),
      og("image", IMAGE.url),
      og("image:type", "image/png"),
      og("image:width", IMAGE.width),
      og("image:height", IMAGE.height),
      og("image:alt", IMAGE.alt),
      twitter("card", "summary_large_image"),
      twitter("title", title),
      twitter("description", description),
      twitter("image", IMAGE.url),
      twitter("image:alt", IMAGE.alt),
    ].join("\n"),
  };
}

export function socialTags() {
  return {
    name: "artpow-social-tags",
    transformIndexHtml: {
      order: "pre",
      handler(html, { path }) {
        if (html.includes('name="robots" content="noindex')) return html; // administration pages: never shared
        const name = path.replace(/^\//, "").replace(/\.html$/, "") || "index";
        const page = PAGES[name];
        if (!page) throw new Error(`scripts/social.mjs: no social tags for the page "${name}"`);
        const { title, description, social } = tags(page);
        return html
          .replace(/<meta name="description"[^>]*\/>/, `<meta name="description" content="${description}" />\n${social}`)
          .replace(/<title>.*<\/title>/, `<title>${title}</title>`);
      },
    },
  };
}
