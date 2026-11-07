import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { falaPorExtenso } from './fala.ts';

Deno.test('sigla vira o nome falado', () => {
  assertEquals(falaPorExtenso('Nos EUA e na UE, o PIB cresce.'), 'Nos Estados Unidos e na União Europeia, o Produto Interno Bruto cresce.');
});

Deno.test('só a sigla exata muda', () => {
  assertEquals(falaPorExtenso('PEUAL, eua, Ti, Viver de IA'), 'PEUAL, eua, Ti, Viver de IA');
});
