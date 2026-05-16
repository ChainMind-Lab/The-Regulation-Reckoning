export default function NavBar() {
  return (
    <nav className="navbar">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span className="navbar-brand">⬡ Regulation Reckoning</span>
        <span className="navbar-wave-badge">Wave 5</span>
      </div>
      <ul className="navbar-links">
        <li><a href="#wave">Wave</a></li>
        <li><a href="#network">Network</a></li>
        <li><a href="#issues">Issues</a></li>
        <li><a href="#topics">Topics</a></li>
        <li><a href="#contribute">Contribute</a></li>
      </ul>
    </nav>
  );
}
