"use client";
export type ComposerOptions = {
  groups: Array<{
    code: string;
    name: string;
    categories: Array<{
      code: string;
      name: string;
      applications: Array<{ application: string }>;
    }>;
  }>;
  hubs: Array<{ id: string; name: string; city: string }>;
  vehicleTypes: Array<{ id: string; name: string }>;
  oems: Array<{ id: string; name: string }>;
  hubScoped: boolean;
};
export type ComposerFields = {
  application: string;
  categoryCode: string;
  hubIds: string[];
  vehicleTypeIds: string[];
  oemIds: string[];
  cities: string;
  scheduledFor: string;
  visibilityExpiresAt: string;
};
export const emptyComposerFields = (): ComposerFields => ({
  application: "RIDER",
  categoryCode: "",
  hubIds: [],
  vehicleTypeIds: [],
  oemIds: [],
  cities: "",
  scheduledFor: "",
  visibilityExpiresAt: "",
});
export function NotificationComposerFields({
  options,
  value,
  disabled,
  onChange,
}: {
  options: ComposerOptions;
  value: ComposerFields;
  disabled: boolean;
  onChange: (value: ComposerFields) => void;
}) {
  const set = (patch: Partial<ComposerFields>) =>
    onChange({ ...value, ...patch });
  return (
    <fieldset disabled={disabled} className="form-stack">
      <legend>Category and recipients</legend>
      <label>
        Application
        <select
          value={value.application}
          onChange={(e) =>
            set({
              application: e.target.value,
              categoryCode: "",
              vehicleTypeIds: [],
              oemIds: [],
            })
          }
        >
          <option value="RIDER">Rider App</option>
          <option value="FLEET_MANAGER">Fleet Manager App</option>
          <option value="TEAM_LEADER">Team Leader App</option>
          <option value="ADMIN">Admin</option>
        </select>
      </label>
      <label>
        Notification category
        <select
          required
          value={value.categoryCode}
          onChange={(e) => set({ categoryCode: e.target.value })}
        >
          <option value="">Choose a category</option>
          {options.groups.map((group) => (
            <optgroup key={group.code} label={group.name}>
              {group.categories
                .filter((c) =>
                  c.applications.some(
                    (a) => a.application === value.application,
                  ),
                )
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      {value.categoryCode.startsWith("PG11_") && (
        <p className="notice">
          Marketing push notifications require each recipient’s consent. Inbox
          history is retained independently.
        </p>
      )}
      <details>
        <summary>Refine audience (optional)</summary>
        <div className="form-stack">
          <p className="muted">
            Leave filters empty to include the full audience. Selected values
            within a filter are combined; recipients must match every filter you
            use.
          </p>
          {options.hubScoped && (
            <p className="notice">
              Your audience is restricted to your assigned hubs, including when
              no hub is selected.
            </p>
          )}
          {(["hubIds", "vehicleTypeIds", "oemIds"] as const).map((key) => {
            const label =
              key === "hubIds"
                ? "Hubs"
                : key === "vehicleTypeIds"
                  ? "Vehicle types (riders only)"
                  : "OEMs (riders only)";
            const choices =
              key === "hubIds"
                ? options.hubs
                : key === "vehicleTypeIds"
                  ? options.vehicleTypes
                  : options.oems;
            return (
              <label key={key}>
                {label}
                <select
                  multiple
                  size={Math.min(4, Math.max(2, choices.length))}
                  value={value[key]}
                  onChange={(e) =>
                    set({
                      [key]: Array.from(
                        e.target.selectedOptions,
                        (o) => o.value,
                      ),
                    })
                  }
                >
                  {choices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          <p className="muted">
            Use Ctrl or ⌘ to select or deselect multiple values.
          </p>
          <label>
            Cities
            <textarea
              rows={2}
              value={value.cities}
              placeholder="Delhi, Pune"
              onChange={(e) => set({ cities: e.target.value })}
            />
          </label>
        </div>
      </details>
      <label>
        Send at (optional)
        <input
          type="datetime-local"
          value={value.scheduledFor}
          onChange={(e) => set({ scheduledFor: e.target.value })}
        />
        <span className="muted">
          Uses your local time. Choose between one minute and 90 days ahead.
          Delivery may take longer. Recipients are captured when you schedule.
        </span>
      </label>
      <label>
        Visible until (optional)
        <input
          type="datetime-local"
          value={value.visibilityExpiresAt}
          onChange={(e) => set({ visibilityExpiresAt: e.target.value })}
        />
        <span className="muted">
          Uses your local time. After this time the notification is hidden from
          the inbox and unsent pushes are skipped.
        </span>
      </label>
      <p className="muted">
        These are operational notices: recipients must still match their current
        audience to read them. Existing personal payment and invoice history is
        unaffected.
      </p>
    </fieldset>
  );
}
