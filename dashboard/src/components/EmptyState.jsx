import React from 'react';

export default function EmptyState({ hint }) {
  return (
    <div className="empty">
      <div className="empty-icon">📋</div>
      <div className="empty-title">Chưa có câu hỏi nào</div>
      <div className="empty-hint">
        {hint || 'Mở một trang HTML có câu hỏi (Canvas Quiz chẳng hạn), sau đó bấm nút "Cào câu hỏi" ở góc trên bên phải.'}
      </div>
    </div>
  );
}
