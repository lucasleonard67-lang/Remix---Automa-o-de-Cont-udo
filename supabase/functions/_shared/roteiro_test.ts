import { assert, assertEquals } from 'jsr:@std/assert@1';

import { conferirEntrega, lerReferencias, planoEmTexto, RECEITA_DA_MONTAGEM, RECEITA_DO_ROTEIRO } from './roteiro.ts';

const plano = {
  resumo: 'Videoaula curta de uma tela do sistema, no estilo da referência.',
  formato: '16:9',
  passos: [
    { id: 'A01', tipo: 'conceito', fala: 'Você já tentou fazer isso na mão? Olha como é simples.' },
    {
      id: 'T01', tipo: 'tela', fala: 'No menu, eu clico em Novo e preencho o nome.',
      acoes: [{ em: 0.3, acao: 'clicar', alvo: 'botão Novo' }, { em: 0.7, acao: 'digitar', alvo: 'campo Nome', valor: 'Teste' }],
      legenda: { termo: 'webhook', texto: 'Um endereço que avisa outro sistema quando algo acontece.' },
    },
    { id: 'P01', tipo: 'tela', fala: 'Colo a chave aqui e salvo.', ao_vivo: true },
  ],
  gravacoes: [{ o_que: 'Tela de cadastro', como: 'Abra o menu, clique em Novo, preencha e salve.' }],
  bastidor: {
    ferramentas: [{ nome: 'Serviço X', para_que: 'envia a mensagem', onde_fica_a_chave: 'Configurações › API' }],
    intervencoes: [{ quando: 'antes do passo P01', o_que: 'colar a chave na tela', minutos: 2 }],
    dados_de_teste: ['o cadastro de teste'],
  },
  efeitos_globais: ['legenda', 'vinheta na abertura e no fim'],
  modelos_extras: [],
  fontes: [{ title: 'Site', url: 'https://exemplo.com' }],
};

Deno.test('entrega completa passa, o roteiro sai dos passos e vira pedido de montagem', () => {
  const r = conferirEntrega('', plano);
  assertEquals(r.problemas, []);
  assert(r.roteiro.startsWith('Você já tentou'));
  assert(r.roteiro.includes('\n\nNo menu'));
  assertEquals(r.plano!.passos[1].acoes!.length, 2);
  assertEquals(r.plano!.passos[2].ao_vivo, true);
  const pedido = planoEmTexto(r.plano!);
  assert(pedido.includes('3 passos: 1 de conceito'));
  assert(pedido.includes('1 ao vivo'));
  assert(pedido.length <= 2000);
});

Deno.test('passo ao vivo sem intervenção, conceito com ações e ação fora da lista viram problemas', () => {
  const r = conferirEntrega('', {
    ...plano,
    bastidor: { ferramentas: [], intervencoes: [], dados_de_teste: [] },
    passos: [
      { id: 'A01', tipo: 'conceito', fala: 'x', acoes: [{ em: 0.5, acao: 'clicar', alvo: 'y' }] },
      { id: 'A01', tipo: 'tela', fala: 'y', acoes: [{ em: 2, acao: 'pular', alvo: '' }] },
      { id: 'P01', tipo: 'tela', fala: 'z', ao_vivo: true },
    ],
  });
  assert(r.problemas.some((p) => p.includes('conceito não tem acoes')));
  assert(r.problemas.some((p) => p.includes('id "A01" repetido')));
  assert(r.problemas.some((p) => p.includes('em vai de 0 a 1')));
  assert(r.problemas.some((p) => p.includes('acao é uma de')));
  assert(r.problemas.some((p) => p.includes('bastidor.intervencoes')));
  assertEquals(r.plano, null);
});

Deno.test('sem passos e formato errado', () => {
  const r = conferirEntrega('', { ...plano, formato: '4:3', passos: [] });
  assert(r.problemas.some((p) => p.startsWith('plano.formato')));
  assert(r.problemas.some((p) => p.startsWith('plano.passos: ao menos')));
  assert(r.problemas.some((p) => p.startsWith('roteiro: falta')));
});

Deno.test('referências só https', () => {
  assertEquals(lerReferencias(['https://a.com/v', { url: 'https://b.com', nota: 'o zoom' }]), [
    { url: 'https://a.com/v' }, { url: 'https://b.com', nota: 'o zoom' },
  ]);
  assertEquals(lerReferencias(['http://a.com']), null);
  assertEquals(lerReferencias(undefined), []);
});

Deno.test('as receitas trazem o método em regras gerais, sem marca', () => {
  assert(RECEITA_DO_ROTEIRO.includes('O BRIEFING MANDA'));
  assert(RECEITA_DO_ROTEIRO.includes('ao_vivo: true'));
  assert(RECEITA_DO_ROTEIRO.includes('apresentador em miniatura'));
  assert(RECEITA_DA_MONTAGEM.includes('1,45x'));
  assert(RECEITA_DA_MONTAGEM.includes('−16 LUFS'));
  assert(RECEITA_DA_MONTAGEM.includes('borrados'));
});
