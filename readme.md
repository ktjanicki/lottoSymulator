An application created as a hobby while traveling. The purpose of the application is to simulate the random selection of numbers selected by the user until the so-called six.

The application uses Parcel 2. Install dependencies and run the development server:

\$ npm install
\$ npm start

Production build goes to `dist/`:

\$ npm run build

Production serves the Parcel build. The page must still work served as-is,
without a build (e.g. a plain static server during development): browser
modules may import only relative paths; `npm test` checks this.

## Deployment

A push to GitHub deploys automatically to
[lottosymulator.grossnet.pl](https://lottosymulator.grossnet.pl); the server
builds and serves the Parcel bundle itself. The deployment is configured
outside this repository — pushing is the release, so push only a commit that
passed `npm test` and `npm run build`. Check the live version in the footer.

## Versioning

The release number lives in the `VERSION` file; release notes are in `CHANGELOG.md`.
`package.json`, `package-lock.json`, `CHANGELOG.md` and `v*` git tags must match it.

## Tests

Node.js version is pinned in `.node-version`; CI (GitHub Actions) runs the same tests and the production build on every push and pull request:

\$ npm test
