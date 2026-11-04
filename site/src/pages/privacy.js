// Privacy policy.
import { contactEmail } from "../lib/config.js";
import { consentChoice, setConsent } from "../lib/consent.js";
import { docPage, section } from "../lib/doc.js";
import { t } from "../lib/i18n.js";
import { h, initLayout } from "../lib/layout.js";

initLayout("privacy");
const choice = consentChoice();
docPage({
  kicker: t("legal.kicker"),
  title: t("privacy.title"),
  lead: t("privacy.lead"),
  note: t("doc.frenchPrevails"),
  sections: [
    section(t("privacy.controller.title"), t("privacy.controller.text", { email: contactEmail })),
    section(t("privacy.always.title"), t("privacy.always.text"), [t("privacy.always.host"), t("privacy.always.rpc"), t("privacy.always.images")]),
    section(t("privacy.consent.title"), t("privacy.consent.text"),
      [t("privacy.consent.reown"), t("privacy.consent.walletconnect")],
      h("p", {}, choice === "yes" ? t("privacy.consent.yes") : choice === "no" ? t("privacy.consent.no") : t("privacy.consent.none")),
      h("div", { class: "row" },
        h("button", { type: "button", class: "secondary", onclick: () => setConsent("yes") }, t("consent.accept")),
        h("button", { type: "button", class: "secondary", onclick: () => setConsent("no") }, t("consent.refuse")))),
    section(t("privacy.relay.title"), t("privacy.relay.text")),
    section(t("privacy.chain.title"), t("privacy.chain.text")),
    section(t("privacy.storage.title"), t("privacy.storage.text")),
    section(t("privacy.transfers.title"), t("privacy.transfers.text")),
    section(t("privacy.rights.title"), t("privacy.rights.text", { email: contactEmail })),
    section(t("privacy.none.title"), t("privacy.none.text")),
  ],
});
