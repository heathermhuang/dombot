import type { OwnerSiteDraft } from '../../../shared/owner-site';
export function ProfileEditor({
  draft,
  lockedHandle,
  onChange,
}: {
  draft: OwnerSiteDraft;
  lockedHandle: boolean;
  onChange: (draft: OwnerSiteDraft) => void;
}) {
  const profile = draft.profile;
  const field = (
    key: 'name' | 'headline' | 'intro' | 'contactEmail',
    value: string,
  ) => onChange({ ...draft, profile: { ...profile, [key]: value } });
  return (
    <section>
      <h2>Profile</h2>
      <p>
        Explain who you are and which conversations you welcome. Your portfolio
        stays private until you select names.
      </p>
      <div className="os-fields">
        <label>
          Site address
          <input
            value={draft.handle}
            disabled={lockedHandle}
            onChange={(e) => onChange({ ...draft, handle: e.target.value })}
            maxLength={40}
          />
          <small>/p/{draft.handle} · fixed after the first save</small>
        </label>
        <label>
          Display name
          <input
            value={profile.name}
            onChange={(e) => field('name', e.target.value)}
            maxLength={100}
          />
        </label>
        <label>
          Headline
          <input
            value={profile.headline}
            onChange={(e) => field('headline', e.target.value)}
            maxLength={160}
          />
        </label>
        <label>
          Introduction
          <textarea
            value={profile.intro}
            onChange={(e) => field('intro', e.target.value)}
            maxLength={600}
          />
        </label>
        <label>
          Investment interests, one per line
          <textarea
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
            value={profile.contactEmail}
            onChange={(e) => field('contactEmail', e.target.value)}
            maxLength={254}
          />
          <small>This address becomes public. Leave blank to hide it.</small>
        </label>
      </div>
      <h3>Profile links</h3>
      {profile.links.map((link, index) => (
        <div className="os-fields os-link" key={index}>
          <label>
            Link label
            <input
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
