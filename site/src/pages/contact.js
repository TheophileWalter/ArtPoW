// Contact page.
import { contactEmail } from "../lib/config.js";
import { docPage, section } from "../lib/doc.js";
import { t } from "../lib/i18n.js";
import { h, initLayout } from "../lib/layout.js";

initLayout("contact");
docPage({
  kicker: t("contact.kicker"),
  title: t("contact.title"),
  lead: t("contact.lead"),
  sections: [
    section(t("contact.address"), h("p", {}, h("a", { href: `mailto:${contactEmail}`, class: "mono" }, contactEmail))),
    section(t("contact.topics.title"), [t("contact.topics.problem"), t("contact.topics.content"), t("contact.topics.artists"), t("contact.topics.press")]),
    section(t("contact.never.title"), t("contact.never.text")),
  ],
});
