'use client';

import { useEffect, useRef, useState } from 'react';

import DynamicSection from '@/components/architecture/DynamicSection';
import PageSideNav from '@/components/shell/PageSideNav';
import { t } from '@/i18n/index.ts';

// The section nav is hardcoded so the sidebar renders instantly without
// waiting for the backend. IDs must match the GUIDE_SECTIONS registry in
// packages/core/openexecutive/guide/sections.py.
const SECTION_IDS = [
  'chat',
  'ask_oe',
  'today',
  'pulse',
  'review',
  'jobs',
  'artifacts',
  'watchlist',
  'departments',
  'people',
  'company_profile',
  'knowledge',
  'skills',
  'custom_tools',
  'council',
  'audit',
  'token_usage',
  'simulator',
  'clients',
  'integrations',
  'settings',
] as const;

const SECTIONS = SECTION_IDS.map((id) => ({
  id,
  get label() {
    return t(`misc.guide.section.${id}.title`);
  },
  get sub() {
    return t(`misc.guide.section.${id}.sub`);
  },
}));

interface SectionMeta {
  id: string;
  fresh: boolean;
  generated_at: string | null;
}

export default function GuidePage() {
  const [activeSection, setActiveSection] = useState('chat');
  const [sectionMeta, setSectionMeta] = useState<Record<string, SectionMeta>>({});
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Single cheap listing call — no generation triggered.
  useEffect(() => {
    fetch('/api/backend/guide/sections')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { sections: SectionMeta[] }) => {
        const map: Record<string, SectionMeta> = {};
        for (const s of data.sections) map[s.id] = s;
        setSectionMeta(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActiveSection(e.target.id);
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
    );
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observerRef.current?.observe(el);
    });
    return () => observerRef.current?.disconnect();
  }, []);

  const freshCount = Object.values(sectionMeta).filter((s) => s.fresh).length;
  const totalCount = SECTIONS.length;

  return (
    <div className="flex flex-col md:flex-row flex-1 min-h-0 bg-surface text-fg overflow-hidden">
      <PageSideNav
        label={t('misc.architecture.section')}
        current={SECTIONS.find((s) => s.id === activeSection)?.label}
        closeKey={activeSection}
        className="md:w-52 bg-surface-elevated"
      >
        <div className="px-3 py-4">
          <p className="px-2 text-[10px] font-semibold uppercase tracking-widest text-fg-subtle mb-2">
            {t('misc.guide.navTitle')}
          </p>
          <nav className="space-y-0.5">
            {SECTIONS.map(({ id, label }) => {
              const meta = sectionMeta[id];
              const dotColor = meta?.fresh ? 'bg-emerald-500/60' : 'bg-surface-input';
              return (
                <a
                  key={id}
                  href={`#${id}`}
                  data-closes-nav
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className={`flex items-center gap-2 px-2 py-2.5 md:py-1.5 rounded-lg text-sm md:text-xs transition-colors ${
                    activeSection === id
                      ? 'bg-indigo-500/10 text-indigo-400'
                      : 'text-fg-muted hover:text-fg hover:bg-surface-overlay/60'
                  }`}
                >
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor}`} />
                  <span>{label}</span>
                </a>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto px-4 py-4 border-t border-line space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-fg-subtle mb-2">
            {t('misc.architecture.reference')}
          </p>
          <div className="flex justify-between text-xs">
            <span className="text-fg-subtle">{t('misc.guide.features')}</span>
            <span className="text-fg-muted font-mono">{freshCount} / {totalCount}</span>
          </div>
          <p className="text-[10px] text-fg-subtle leading-relaxed">
            {t('misc.guide.navBlurb')}
          </p>
        </div>
      </PageSideNav>

      <main className="flex-1 min-h-0 min-w-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-6 sm:px-8 sm:py-10 space-y-12 sm:space-y-20">
          <div>
            <h1 className="text-2xl font-bold text-fg">{t('misc.guide.title')}</h1>
            <p className="mt-2 text-sm text-fg-muted">
              {t('misc.guide.intro')}
            </p>
          </div>

          {SECTIONS.map(({ id, label, sub }) => (
            <DynamicSection key={id} id={id} title={label} sub={sub} basePath="guide" />
          ))}
        </div>
      </main>
    </div>
  );
}
