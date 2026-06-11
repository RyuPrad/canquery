export default function Footer() {
  return (
    <footer className="footer footer-center bg-base-200 text-base-content/70 p-6 mt-12 text-sm">
      <p>
        Contains information licensed under the{' '}
        <a
          href="https://open.canada.ca/en/open-government-licence-canada"
          target="_blank"
          rel="noreferrer"
          className="link"
        >
          Open Government Licence - Canada
        </a>
        .
      </p>
      <p>opencanada is an independent project and is not affiliated with the Government of Canada.</p>
      <p className="opacity-60">Data is mirrored and cached from open.canada.ca.</p>
    </footer>
  );
}
