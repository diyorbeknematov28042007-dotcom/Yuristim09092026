import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { webEnv } from '../../config/env';

interface LawyerProfile {
  bio: string | null;
  consultationPrice: number | null;
  currency: 'UZS';
  duid: string;
  experienceYears: number | null;
  fullName: string | null;
  jobsCount: number;
  profileImageUrl: string | null;
  ratingAverage: number;
  ratingCount: number;
  region: string | null;
  specializations: Array<{ code: string; id: string; name: string }>;
  telegramUsername: string | null;
  verificationStatus: 'approved';
}

async function getProfile(duid: string): Promise<LawyerProfile> {
  if (!/^yr_[A-Za-z0-9_-]{8,48}$/.test(duid)) notFound();
  const response = await fetch(
    new URL(`/lawyers/${duid}?language=uz`, webEnv.NEXT_PUBLIC_API_URL),
    { cache: 'no-store' },
  );
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('Lawyer profile API is unavailable');
  const payload = (await response.json()) as { profile?: LawyerProfile };
  if (!payload.profile || payload.profile.verificationStatus !== 'approved') notFound();
  return payload.profile;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ duid: string }>;
}): Promise<Metadata> {
  const { duid } = await params;
  return { description: 'Yuristim tasdiqlangan yurist profili', title: `${duid} — Yuristim` };
}

export default async function LawyerPublicPage({ params }: { params: Promise<{ duid: string }> }) {
  const { duid } = await params;
  const profile = await getProfile(duid);
  const name = profile.fullName ?? 'Yuristim yuristi';
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <main className="profile-shell">
      <article className="lawyer-card">
        <header className="lawyer-header">
          <div className="profile-avatar" aria-label={`${name} profil rasmi`}>
            {profile.profileImageUrl ? (
              <Image
                alt={`${name} profil rasmi`}
                fill
                sizes="112px"
                src={profile.profileImageUrl}
                style={{ objectFit: 'cover' }}
              />
            ) : (
              <span aria-hidden="true">{initials || 'Y'}</span>
            )}
          </div>
          <div>
            <p className="verified-badge">✓ Tasdiqlangan yurist</p>
            <h1 className="profile-name">{name}</h1>
            <p className="profile-duid">{profile.duid}</p>
          </div>
        </header>

        <dl className="profile-facts">
          <div>
            <dt>Hudud</dt>
            <dd>{profile.region ?? 'Ko‘rsatilmagan'}</dd>
          </div>
          <div>
            <dt>Tajriba</dt>
            <dd>
              {profile.experienceYears === null
                ? 'Ko‘rsatilmagan'
                : `${profile.experienceYears} yil`}
            </dd>
          </div>
          <div>
            <dt>Reyting</dt>
            <dd>
              {profile.ratingAverage.toFixed(1)} / 5 · {profile.ratingCount} baho
            </dd>
          </div>
          <div>
            <dt>Bajarilgan ishlar</dt>
            <dd>{profile.jobsCount}</dd>
          </div>
        </dl>

        <section>
          <h2>Mutaxassisliklar</h2>
          <ul className="specialization-list">
            {profile.specializations.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Yurist haqida</h2>
          <p className="profile-bio">{profile.bio}</p>
        </section>

        <footer className="profile-footer">
          <div>
            <span>Konsultatsiya</span>
            <strong>
              {profile.consultationPrice === null
                ? 'Kelishiladi'
                : `${profile.consultationPrice.toLocaleString('uz-UZ')} UZS`}
            </strong>
          </div>
          {profile.telegramUsername ? (
            <a href={`https://t.me/${profile.telegramUsername}`} rel="noreferrer">
              Telegram orqali bog‘lanish
            </a>
          ) : (
            <span>Telegram aloqa mavjud emas</span>
          )}
        </footer>
      </article>
    </main>
  );
}
