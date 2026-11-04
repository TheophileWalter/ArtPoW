// Page for artists: the offer as it is, the No AI charter, the licence and the call for applications.
import { contactEmail } from "../lib/config.js";
import { docPage, section } from "../lib/doc.js";
import { t } from "../lib/i18n.js";
import { h, initLayout } from "../lib/layout.js";

initLayout("artists");
docPage({
  kicker: t("artists.kicker"),
  title: t("artists.title"),
  lead: t("artists.lead"),
  sections: [
    section(t("artists.offer.title"), [t("artists.offer.proof"), t("artists.offer.credit"), t("artists.offer.lasting"), t("artists.offer.free")]),
    section(t("artists.limits.title"), [t("artists.limits.pay"), t("artists.limits.royalties"), t("artists.limits.audience"), t("artists.limits.edition"), t("artists.limits.final")]),
    section(t("artists.format.title"), t("artists.format.text"), t("artists.format.crop")),
    section(t("artists.charter.title"), t("artists.charter.text"), [t("artists.charter.human"), t("artists.charter.tools"), t("artists.charter.training"), t("artists.charter.protected")], t("artists.charter.limit")),
    section(t("artists.licence.title"), t("artists.licence.intro"),
      h("ol", {}, [t("artists.licence.1"), t("artists.licence.2"), t("artists.licence.3"), t("artists.licence.4"), t("artists.licence.5"), t("artists.licence.6")].map((text) => h("li", {}, text)))),
    section(t("artists.apply.title"), t("artists.apply.text", { email: contactEmail }), [t("artists.apply.name"), t("artists.apply.work"), t("artists.apply.idea"), t("artists.apply.address")], t("artists.apply.choice"),
      h("div", { class: "row" }, h("a", { class: "button", href: `mailto:${contactEmail}?subject=ArtPoW` }, t("artists.apply.cta")))),
  ],
});
