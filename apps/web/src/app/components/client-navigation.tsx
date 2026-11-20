"use client";
import { useRouter } from "next/navigation";
import { Fragment, type Dispatch, type SetStateAction } from "react";
import { CLIENT_NAVIGATION, CLIENT_TAB_ICONS, canAccessTab, type Tab } from "./client-navigation-model";
import { UiIcon } from "./ui-icon";
import { ClientBrandingSettings } from "./client-branding-settings";
import { useLocale } from "./locale-provider";
import { requestNavigation } from "./unsaved-changes";

const KYC_ITEMS = [
  ["overview", "Overview", "dashboard"], ["riders", "Rider KYC", "user"],
  ["reviews", "Manual Review", "shield"], ["verifications", "Verification Requests", "audit"],
  ["workflows", "Workflows", "allocation"], ["definitions", "Configuration", "factory"],
  ["health", "Health & Usage", "usage"],
] as const;
export type KycNavigationSection = typeof KYC_ITEMS[number][0];

export function ClientNavigation({ tab, kycSection, userRoles, token = "", expandedClientNavGroups, setExpandedClientNavGroups, onNavigate, onNavigateKyc }: {
  tab?: Tab; kycSection?: string; userRoles: string[]; token?: string;
  expandedClientNavGroups: Record<string, boolean>;
  setExpandedClientNavGroups: Dispatch<SetStateAction<Record<string, boolean>>>;
  onNavigate?: (tab: Tab) => void;
  onNavigateKyc?: (section: KycNavigationSection) => void;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const canSeeTab = (id: Tab) => canAccessTab(id, userRoles);
  const canSeeKyc = userRoles.some(role => role === "CLIENT_ADMIN" || role === "KYC_OPERATOR");
  const activeKycSection = ["providers", "routing"].includes(kycSection ?? "") ? "definitions" : kycSection === "commercial" ? "health" : kycSection;
  return (
        <nav className="client-navigation" aria-label="Client operations">
          {CLIENT_NAVIGATION.filter(section => section.items.some(item => canSeeTab(item.id)) || (section.kyc && canSeeKyc) || (section.branding && userRoles.includes("CLIENT_ADMIN"))).map((section, index) => (
            <div
              className="sa-nav-group client-nav-section"
              key={`${section.label}-${index}`}
            >
              {section.label && (
                <button
                  type="button"
                  className="sa-nav-group-toggle"
                  data-active={section.items.some((item) => item.id === tab)}
                  aria-expanded={expandedClientNavGroups[section.label] ?? false}
                  aria-controls={`client-nav-group-${index}`}
                  onClick={() => setExpandedClientNavGroups((current) => ({
                    ...current,
                    [section.label]: !(current[section.label] ?? false),
                  }))}
                >
                  <span>{t(section.label)}</span>
                  <UiIcon
                    name="chevron"
                    className={(expandedClientNavGroups[section.label] ?? false) ? "" : "is-collapsed"}
                  />
                </button>
              )}
              <div
                id={`client-nav-group-${index}`}
                className="client-nav-items"
                hidden={Boolean(section.label) && !(expandedClientNavGroups[section.label] ?? false)}
              >
                {section.items.filter((item) => canSeeTab(item.id)).map((item, itemIndex, visibleItems) => (
                  <Fragment key={item.id}>
                    {item.group && item.group !== visibleItems[itemIndex - 1]?.group && (
                      <p className="client-nav-subheading">{t(item.group)}</p>
                    )}
                    <button
                      type="button"
                      className={`${tab === item.id ? "active" : ""} ${section.label ? "sa-nav-child" : ""}`}
                      aria-current={tab === item.id ? "page" : undefined}
                      onClick={() => onNavigate ? onNavigate(item.id) : requestNavigation(() => router.push(`/?tab=${item.id}`))}
                    >
                      {item.id === "cluster-managers" || item.id === "team-leads" || item.id === "fleet-managers"
                        ? <span aria-hidden="true" className={`client-role-art client-role-art-${item.id}`} />
                        : <UiIcon name={CLIENT_TAB_ICONS[item.id]} />}
                      {t(item.label)}
                    </button>
                  </Fragment>
                ))}
                {section.branding && <ClientBrandingSettings token={token} triggerClassName="sa-nav-child" />}
              </div>
            </div>
          ))}
          {canSeeKyc && <div className="sa-nav-group client-nav-section">
            <button type="button" className="sa-nav-group-toggle" data-active={Boolean(kycSection)} aria-expanded={expandedClientNavGroups["KYC & Verification"] ?? Boolean(kycSection)} aria-controls="client-kyc-navigation" onClick={() => setExpandedClientNavGroups(current => ({ ...current, "KYC & Verification": !(current["KYC & Verification"] ?? Boolean(kycSection)) }))}>
              <span>{t("KYC & Verification")}</span><UiIcon name="chevron" className={(expandedClientNavGroups["KYC & Verification"] ?? Boolean(kycSection)) ? "" : "is-collapsed"} />
            </button>
            <div id="client-kyc-navigation" className="client-nav-items" hidden={!(expandedClientNavGroups["KYC & Verification"] ?? Boolean(kycSection))}>
              {KYC_ITEMS.map(([section, label, icon]) => <button key={section} type="button" className={`sa-nav-child ${activeKycSection === section ? "active" : ""}`} aria-current={activeKycSection === section ? "page" : undefined} onClick={() => onNavigateKyc ? onNavigateKyc(section) : requestNavigation(() => router.push(`/client/kyc?section=${section}`))}><UiIcon name={icon} />{t(label)}</button>)}
            </div>
          </div>}
        </nav>
  );
}
