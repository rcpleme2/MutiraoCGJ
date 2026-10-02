import React from 'react';

/** Evita que um erro de renderização (por exemplo, um dado inesperado) deixe a página inteira em branco. */
export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Erro de renderização:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="card max-w-lg mx-auto p-8 text-center">
        <h2 className="text-xl font-semibold text-navy">Não foi possível exibir esta tela</h2>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          Ocorreu um erro inesperado ao montar o conteúdo. Recarregue a página; se o problema persistir, avise a administração.
        </p>
        <button className="btn-primary mt-5" onClick={() => window.location.reload()}>Recarregar a página</button>
      </div>
    );
  }
}
