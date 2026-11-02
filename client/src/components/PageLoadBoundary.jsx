import { Component } from 'react';
import { useLang } from '../i18n.jsx';

function PageLoadFailed() {
  const { t } = useLang();
  return (
    <div className="text-center py-28 space-y-4" role="alert">
      <p className="text-lg">{t('common.page_load_failed')}</p>
      <button type="button" className="btn btn-sm btn-outline" onClick={() => window.location.reload()}>
        {t('common.reload')}
      </button>
    </div>
  );
}

// A page whose code fails to load (a release replaced its chunk, or the
// network dropped) used to blank the whole application. The page area says so
// and offers a reload instead; opening another address clears it.
export default class PageLoadBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    return this.state.failed ? <PageLoadFailed /> : this.props.children;
  }
}
