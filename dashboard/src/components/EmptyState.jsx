import React, { useEffect, useState } from 'react';
import { t, onLanguageChange } from '../i18n.js';

export default function EmptyState({ hint }) {
  const [, force] = useState(0);
  useEffect(() => onLanguageChange(() => force(n => n + 1)), []);

  return (
    <div className="empty">
      <div className="empty-icon">📋</div>
      <div className="empty-title">{t('empty_title')}</div>
      <div className="empty-hint">
        {hint || t('empty_hint_ext')}
      </div>
    </div>
  );
}
