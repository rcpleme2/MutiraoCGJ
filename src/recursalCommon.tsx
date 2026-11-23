// Peças visuais comuns do Mutirão da Turma Recursal (portal e administração).
export const TURMAS = [1, 2, 3, 4, 5, 6] as const;
/** Cor-código estável de cada Turma (matiz distinto, saturação baixa para combinar com o tema) */
const HUES = [212, 152, 36, 280, 350, 190];
export const turmaStyle = (t: number) => { const h = HUES[(t - 1) % 6]; return { backgroundColor: `hsl(${h} 45% 92%)`, color: `hsl(${h} 55% 28%)`, borderColor: `hsl(${h} 40% 78%)` }; };

export function TurmaChip({ turma, dim = false }: { turma: number | null; dim?: boolean }) {
  if (!turma) return <span className="text-xs text-muted">—</span>;
  return <span title={`${turma}ª Turma Recursal`} style={turmaStyle(turma)} className={`inline-flex items-center justify-center min-w-[2.1rem] px-2 py-0.5 rounded border text-xs font-semibold ${dim ? 'opacity-40' : ''}`}>{turma}ª</span>;
}

export const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
  r.readAsDataURL(file);
});
