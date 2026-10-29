# Contributing to LuantiHub

Thank you for your interest in contributing to **LuantiHub**! We welcome contributions of all kinds: bug reports, feature suggestions, code enhancements, documentation improvements, and especially **translations**.

---

## 📑 Table of Contents
- [Code of Conduct](#-code-of-conduct)
- [Development Setup](#-development-setup)
- [Contributing Translations (i18n)](#-contributing-translations-i18n)
  - [Architecture Overview](#architecture-overview)
  - [Option 1: Improving Existing Translations](#option-1-improving-existing-translations)
  - [Option 2: Adding a New Language via Pull Request](#option-2-adding-a-new-language-via-pull-request)
  - [Option 3: Submitting Translations via GitHub Issues (No Code Required!)](#option-3-submitting-translations-via-github-issues-no-code-required)
- [Testing & Quality Checks](#-testing--quality-checks)
- [Submitting a Pull Request](#-submitting-a-pull-request)
- [License](#-license)

---

## 🤝 Code of Conduct
Please be polite, constructive, and respectful to fellow community members and maintainers. We aim to keep the Luanti and LuantiHub community open, friendly, and welcoming to everyone.

---

## 🛠️ Development Setup

### Prerequisites
- **Node.js**: `>= 22.22.3` or `>= 24.15.0` (LTS recommended: `v24.x`)
- **npm**: `>= 10.0.0`
- **Git**

### Installation & Local Run
```bash
# 1. Clone the repository (or your fork)
git clone https://github.com/sakel-hub/luanti-hub.git
cd luanti-hub

# 2. Install dependencies
npm install

# 3. Start the local frontend development server
npm start
```
The app will run at `http://localhost:4200/`.

For full-stack Cloudflare Pages Functions and edge D1 testing:
```bash
npm run dev:cloudflare
```

---

## 🌍 Contributing Translations (i18n)

LuantiHub features compile-time type-safe localization powered by TypeScript interfaces located in [`src/app/core/i18n/`](src/app/core/i18n/).

### Architecture Overview
* **[`src/app/core/i18n/translation.types.ts`](src/app/core/i18n/translation.types.ts)**: Declares the `TranslationDictionary` interface, `LocaleId` union, and `SUPPORTED_LOCALES` metadata list.
* **[`src/app/core/i18n/locales/en.ts`](src/app/core/i18n/locales/en.ts)**: English reference dictionary (canonical source of truth).
* **[`src/app/core/i18n/locales/`](src/app/core/i18n/locales/)**: Individual language dictionaries (`sk.ts`, `de.ts`, `fr.ts`, `es.ts`, `ru.ts`).
* **[`src/app/core/i18n/translation.service.ts`](src/app/core/i18n/translation.service.ts)**: Active locale signal, language detection, persistence in `localStorage`, and runtime fallback.

Currently supported languages:
- 🇬🇧 **English** (`en`)
- 🇸🇰 **Slovak** (`sk`)
- 🇩🇪 **German** (`de`)
- 🇫🇷 **French** (`fr`)
- 🇪🇸 **Spanish** (`es`)
- 🇷🇺 **Russian** (`ru`)

---

### Option 1: Improving Existing Translations

If you spot a typo, awkward phrasing, or untranslated string in one of the existing locales:
1. Open the relevant locale file: `src/app/core/i18n/locales/<lang>.ts`.
2. Edit the translation string while preserving placeholders (e.g. `{count}`, `{author}`, `{name}`).
3. Run `npx tsc --noEmit` to verify type safety.
4. Test in your browser by selecting the language in the header dropdown.
5. Submit a Pull Request.

---

### Option 2: Adding a New Language via Pull Request

Follow these steps to add a new language (e.g., Italian `it`, Polish `pl`, Ukrainian `uk`, Japanese `ja`, Portuguese `pt`):

#### 1. Create the Locale File
Copy `src/app/core/i18n/locales/en.ts` to `src/app/core/i18n/locales/<localeId>.ts` (e.g. `it.ts`):
```bash
cp src/app/core/i18n/locales/en.ts src/app/core/i18n/locales/it.ts
```
Translate the string values inside:
```typescript
import { TranslationDictionary } from '../translation.types';

export const it: TranslationDictionary = {
  header: {
    title: 'LuantiHub',
    subtitle: 'Registro Pacchetti & Hub Contenuti',
    // ...
  },
  // ...
};
```

#### 2. Register Locale ID & Metadata
In [`src/app/core/i18n/translation.types.ts`](src/app/core/i18n/translation.types.ts):
```typescript
export type LocaleId = 'en' | 'sk' | 'de' | 'fr' | 'es' | 'ru' | 'it';

export const SUPPORTED_LOCALES: LocaleMeta[] = [
  // ...
  { id: 'it', label: 'Italian', nativeLabel: 'Italiano' }
];
```

#### 3. Register Dictionary in Service
In [`src/app/core/i18n/translation.service.ts`](src/app/core/i18n/translation.service.ts):
```typescript
import { it } from './locales/it';

const DICTIONARIES: Record<LocaleId, TranslationDictionary> = {
  en,
  sk,
  de,
  fr,
  es,
  ru,
  it
};
```

#### 4. Verify Type-Safety & Test
```bash
npx tsc --noEmit
npm start
```
Navigate to `http://localhost:4200/?lang=it` to inspect your new language in action.

---

### Option 3: Submitting Translations via GitHub Issues (No Code Required!)

If you do not want to use Git or edit TypeScript files, you can submit translations directly by opening a GitHub Issue!

1. Go to [**GitHub Issues &rarr; New Issue**](https://github.com/sakel-hub/luanti-hub/issues/new).
2. Set the title to: `i18n: Add [Language Name] translation` (e.g. `i18n: Add Italian translation`).
3. Copy and paste the template below with your translations:

```markdown
### Language Information
- **Language**: Italian (Italiano)
- **Language Code**: it

### Translations
| Key | English Reference | Your Translation |
| :--- | :--- | :--- |
| `header.title` | LuantiHub | LuantiHub |
| `header.subtitle` | Package Registry & Content Hub | Registro Pacchetti & Hub Contenuti |
| `header.searchPlaceholder` | Search packages, mods, games, authors... | Cerca pacchetti, mod, giochi, autori... |
| `header.filterAll` | All | Tutti |
| `header.filterMods` | Mods | Mod |
| `header.filterGames` | Games | Giochi |
| `header.filterTxp` | Texture Packs | Pacchetti grafici |
| `header.installApp` | Install App | Installa App |
| `header.inGameSetup` | In-Game Setup | Configurazione in gioco |
| `package.downloads` | downloads | download |
| `package.rating` | Rating | Valutazione |
| `package.installInGame` | Install in Luanti | Installa in Luanti |
| `package.downloadZip` | Download .zip | Scarica .zip |
| `package.viewReadme` | View README | Mostra README |
| `package.reviews` | Reviews | Recensioni |
| `package.dependencies` | Dependencies | Dipendenze |
```

A maintainer will incorporate your translations into the codebase on your behalf!

---

## 🧪 Testing & Quality Checks

Please ensure tests and compiler checks pass before opening a Pull Request:

```bash
# 1. Run unit test suite (Vitest)
npm test

# 2. Strict TypeScript compilation check
npx tsc --noEmit

# 3. Production build check
npm run build
```

---

## 🚀 Submitting a Pull Request

1. Fork the repository on GitHub.
2. Create a clean feature branch:
   ```bash
   git checkout -b i18n/add-italian
   # or
   git checkout -b feature/my-cool-feature
   ```
3. Commit your changes with a descriptive message:
   ```bash
   git commit -m "i18n: Add Italian (it) translation"
   ```
4. Push your branch to your fork and submit a Pull Request on GitHub.

---

## 📄 License

LuantiHub source code is licensed under the **GNU Lesser General Public License, version 2.1 or later** ([`LICENSE.txt`](LICENSE.txt)).

By contributing to LuantiHub, you agree that your contributions will be licensed under the same LGPL-2.1-or-later terms.

