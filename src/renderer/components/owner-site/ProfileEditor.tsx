import type { OwnerSiteDraft } from '../../../shared/owner-site';
export function ProfileEditor({
  draft,
  lockedHandle,
  showAddress = true,
  onChange,
}: {
  draft: OwnerSiteDraft;
  lockedHandle: boolean;
  showAddress?: boolean;
  onChange: (draft: OwnerSiteDraft) => void;
}) {
  const profile = draft.profile;
  const field = (
    key: 'name' | 'headline' | 'intro' | 'contactEmail',
    value: string,
  ) => onChange({ ...draft, profile: { ...profile, [key]: value } });
  return (
    <section data-field="profile" tabIndex={-1}>
      <h2>Profile</h2>
      <p>
        Explain who you are and which conversations you welcome. Your portfolio
        stays private until you select names.
      </p>
      <div className="os-fields">
        {showAddress && (
          <label>
            Site address
            <input
              data-field="handle"
              value={draft.handle}
              disabled={lockedHandle}
              onChange={(e) => onChange({ ...draft, handle: e.target.value })}
              maxLength={40}
            />
            <small>/p/{draft.handle} · fixed after the first save</small>
          </label>
        )}
        <label>
          Display name
          <input
            data-field="profile.name"
            value={profile.name}
            onChange={(e) => field('name', e.target.value)}
            maxLength={100}
          />
        </label>
        <label>
          Headline
          <input
            data-field="profile.headline"
            value={profile.headline}
            onChange={(e) => field('headline', e.target.value)}
            maxLength={160}
          />
        </label>
        <label>
          Introduction
          <textarea
            data-field="profile.intro"
            value={profile.intro}
            onChange={(e) => field('intro', e.target.value)}
            maxLength={600}
          />
        </label>
        <label>
          Investment interests, one per line
          <textarea
            data-field="profile.interests"
            value={profile.interests.join('\n')}
            onChange={(e) =>
              onChange({
                ...draft,
                profile: { ...profile, interests: e.target.value.split('\n') },
              })
            }
            onBlur={(e) =>
              onChange({
                ...draft,
                profile: {
                  ...profile,
                  interests: e.target.value.split('\n').filter(Boolean),
                },
              })
            }
          />
        </label>
        <label>
          Conversations welcome, one per line
          <textarea
            data-field="profile.opportunities"
            value={profile.opportunities.join('\n')}
            onChange={(e) =>
              onChange({
                ...draft,
                profile: {
                  ...profile,
                  opportunities: e.target.value.split('\n'),
                },
              })
            }
            onBlur={(e) =>
              onChange({
                ...draft,
                profile: {
                  ...profile,
                  opportunities: e.target.value.split('\n').filter(Boolean),
                },
              })
            }
          />
        </label>
        <label>
          Public contact email (optional)
          <input
            type="email"
            data-field="profile.contactEmail"
            value={profile.contactEmail}
            onChange={(e) => field('contactEmail', e.target.value)}
            maxLength={254}
          />
          <small>This address becomes public. Leave blank to hide it.</small>
        </label>
      </div>
      <h3 data-field="profile.links" tabIndex={-1}>
        Profile links
      </h3>
      {profile.links.map((link, index) => (
        <div
          className="os-fields os-link"
          key={index}
          data-field={`profile.links.${index}`}
          tabIndex={-1}
        >
          <label>
            Link label
            <input
              data-field={`profile.links.${index}.label`}
              value={link.label}
              onChange={(e) =>
                onChange({
                  ...draft,
                  profile: {
                    ...profile,
                    links: profile.links.map((v, i) =>
                      i === index ? { ...v, label: e.target.value } : v,
                    ),
                  },
                })
              }
              maxLength={80}
            />
          </label>
          <label>
            HTTPS link
            <input
              type="url"
              data-field={`profile.links.${index}.url`}
              value={link.url}
              onChange={(e) =>
                onChange({
                  ...draft,
                  profile: {
                    ...profile,
                    links: profile.links.map((v, i) =>
                      i === index ? { ...v, url: e.target.value } : v,
                    ),
                  },
                })
              }
            />
          </label>
          <button
            onClick={() =>
              onChange({
                ...draft,
                profile: {
                  ...profile,
                  links: profile.links.filter((_, i) => i !== index),
                },
              })
            }
          >
            Remove link {index + 1}
          </button>
        </div>
      ))}
      <button
        disabled={profile.links.length >= 20}
        onClick={() =>
          onChange({
            ...draft,
            profile: {
              ...profile,
              links: [...profile.links, { label: 'Website', url: '' }],
            },
          })
        }
      >
        Add profile link
      </button>
    </section>
  );
}
