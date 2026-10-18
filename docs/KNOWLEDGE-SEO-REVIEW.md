# Knowledge, motion and frontend review — 18 October 2026

## Implemented

- 12 source-linked guides: MoFA, education, personal records, POA, recognition, apostille, commercial documents, trade invoices, translation, business setup, employment/PRO and document problems.
- 249 country/territory directory entries from the public-domain tz database ISO table. Seven published source notes: AE, IN, GB, PK, AU, BT, IS. The other entries explicitly require mission review; no individual law, fee, timeline or procedure is asserted for them.
- Dated editorial source checks and a 30-day review-due state. These labels are not legal sign-off or a continuous legal monitoring service.
- Server-rendered guide content, canonical and social metadata, Article/Breadcrumb/Service markup, sitemap, robots controls, llms.txt and real 404 responses for unknown guides/countries/services/pages.
- Private workflows and unreviewed country details receive noindex directives. Sitemap omits those entries and draft legal pages. No invented reviews, ratings, government authorisations or business addresses.
- Scroll reveals, reading progress, smooth anchor navigation, subtle gradients, restrained hover transitions and reduced-motion alternatives.
- Two original photographic assets, revised vector browser logo lockups, consistent tagline spacing, accessible form labels, keyboard record activation, dialog focus trapping/restoration, mobile full-workspace navigation and print styles for guides.
- Existing sample operational fee/route registry is explicitly distinguished from the editorial guides. It has not been relabelled as verified current law.

## Source checks and limits

MoFA service card and FAQ, London/New Delhi/Islamabad/Canberra mission pages, MoHESR recognition service, HCCH convention table, FCDO legalisation guidance, Dubai Courts Smart Electronic Notary search result, UAE government mainland setup page/search result, Invest in Dubai and MOHRE Work Bundle search result were consulted. Each guide links its exact official references.

Some official pages were inaccessible or only partly rendered. Those gaps were not filled with invented procedure. The Islamabad page contains a cross-country reference in the POA paragraph; that specific statement is not adopted and the country note asks for mission confirmation. No claim is made that all countries' laws, every individual case, or every possible licence/visa route have been legally verified. Detailed individual legal drafting, tax advice, regulatory permissions and launch legal policies require the relevant qualified specialist.

New knowledge copy is English-first. Existing application language switching is retained; complete Arabic legal/editorial localisation remains outstanding.

## Search implementation

Express serves guide/country article text in initial HTML alongside the React bundle. Browser navigation updates matching metadata. This is a crawler-readable fallback, not hydration. The runtime requires the `shared/` directory, included in the Docker image. Set `SEO_BASE_URL` to the deployed canonical origin. Static-only hosting does not execute Express metadata routes; use the supplied Node/Docker deployment.

Sitemap and structured data improve discoverability and clarity; they do not guarantee rankings, rich results, AI citations or “100% SEO/AEO/GEO/AIO”. llms.txt is an informational convention, not an access control or search-engine guarantee.

## Verification

Production Vite build, server regression tests and dedicated SEO/content-boundary tests. Static validation covers SVG syntax and referenced image existence. Browser visual/interaction QA is unavailable in this environment. Updated browser smoke cases run in the repository's CI workflow, which installs Chromium.
