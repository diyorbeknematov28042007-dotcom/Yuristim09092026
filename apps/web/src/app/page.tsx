import { YuristimMark } from '@yuristim/ui';
import { webEnv } from '../config/env';

export default function HomePage() {
  return (
    <main className="shell">
      <section aria-labelledby="page-title" className="hero">
        <YuristimMark className="mark" />
        <p className="eyebrow">LegalTech Platform</p>
        <h1 id="page-title">Yuristim</h1>
        <p className="summary">
          O‘zbekiston fuqarolari, talabalari va yuristlari uchun yagona huquqiy platforma.
        </p>
        <p className="status">
          <span aria-hidden="true" className="status-dot" />
          Foundation ishlamoqda
        </p>
        <p className="api-endpoint">API: {webEnv.NEXT_PUBLIC_API_URL}</p>
      </section>
    </main>
  );
}
