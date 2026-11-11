type ReferralPageProps = {
  searchParams: Promise<{ code?: string | string[]; invite?: string | string[]; campaign?: string | string[] }>;
};

export default async function RiderReferralPage({ searchParams }: ReferralPageProps) {
  const params = await searchParams;
  const rawCode = Array.isArray(params.code) ? params.code[0] : params.code;
  const code = rawCode?.trim().toUpperCase() ?? "";
  const validCode = /^EVS-[A-Z2-9]{8}$/.test(code);
  const deepLink = new URL("evseye-rider://referral");
  if (validCode) deepLink.searchParams.set("utm_source", code);
  const invite = Array.isArray(params.invite) ? params.invite[0] : params.invite;
  if (invite) deepLink.searchParams.set("invite", invite);
  const campaign = Array.isArray(params.campaign) ? params.campaign[0] : params.campaign;
  if (campaign && /^[A-Z0-9_]{3,48}$/.test(campaign)) deepLink.searchParams.set("campaign", campaign);

  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f4f8f5", color: "#18372b" }}>
    <section style={{ width: "min(100%, 440px)", background: "white", border: "1px solid #dcebe1", borderRadius: 20, padding: 28, boxShadow: "0 14px 40px #18372b12" }}>
      <p style={{ color: "#18734a", fontWeight: 700, letterSpacing: 2, marginTop: 0 }}>EVsEye Rider</p>
      <h1 style={{ marginBottom: 12 }}>Rider referral</h1>
      {validCode ? <>
        <p>Open the rider app to join with this referral code.</p>
        <p style={{ fontSize: 24, fontWeight: 800, letterSpacing: 1, margin: "24px 0" }}>{code}</p>
        <a href={deepLink.toString()} style={{ display: "block", textAlign: "center", padding: "13px 18px", borderRadius: 10, background: "#18734a", color: "white", fontWeight: 700, textDecoration: "none" }}>Open Rider app</a>
        <p style={{ fontSize: 14, color: "#64746b", marginBottom: 0 }}>If the app is not installed, keep this code and enter it during rider onboarding.</p>
      </> : <p>This referral link does not contain a valid rider code. Ask the rider to share a new link.</p>}
    </section>
  </main>;
}
