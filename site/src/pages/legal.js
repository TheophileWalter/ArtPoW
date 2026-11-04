// Legal notice.
import { contactEmail } from "../lib/config.js";
import { docPage, section } from "../lib/doc.js";
import { t } from "../lib/i18n.js";
import { initLayout } from "../lib/layout.js";

initLayout("legal");
docPage({
  kicker: t("legal.kicker"),
  title: t("legal.title"),
  note: t("doc.frenchPrevails"),
  sections: [
    section(t("legal.publisher.title"), t("legal.publisher.text")),
    section(t("legal.contact.title"), t("legal.contact.text", { email: contactEmail })),
    section(t("legal.host.title"), t("legal.host.text")),
    section(t("legal.works.title"), t("legal.works.text")),
    section(t("legal.mining.title"), t("legal.mining.text")),
  ],
});
