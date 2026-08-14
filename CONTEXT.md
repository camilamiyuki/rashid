# Rashid

App interno de engenharia (~35 pessoas) para organizar e ratear compras de comida em grupo (esfiha, pizza, etc.): alguém abre um pedido coletivo, junta a galera em tempo real, e no fim cada participante recebe uma cobrança PIX com a sua parte.

## Language

**Racha**:
Sessão de compra coletiva de comida com um valor total a ser rateado entre os participantes. É a "sala"/"lobby" da ideia original.
_Avoid_: Sala, Lobby, Pedido, Rodada (usar "Racha" como termo canônico) — _provisório, a confirmar_

**Organizador**:
Participante que abre o Racha, adianta o pagamento da conta cheia ao restaurante e recebe os reembolsos. Dono da chave PIX usada nas cobranças.
_Avoid_: Admin, Dono da sala

**Participante**:
Pessoa que entra num Racha e deve a sua parte do valor total ao Organizador. Identificado apenas por um nome digitado, sem login nem perfil persistente.
_Avoid_: Usuário, Convidado

_Consequências de não ter login (MVP):_ o Organizador cola a chave PIX a cada Racha; não há histórico confiável de dívidas entre pessoas; qualquer um pode digitar o nome de outro (aceitável no contexto interno de confiança).

**Reembolso**:
Pagamento PIX que um Participante faz ao Organizador para quitar a sua parte. O app nunca fala com o restaurante — só rateia e cobra de volta. Marcado como pago **manualmente pelo Organizador** (conferindo o extrato); o app não detecta o PIX.
_Avoid_: Pagamento (ambíguo com o pagamento ao restaurante)

**Parte**:
Valor que cada Participante deve = total do Racha ÷ número de participantes (rateio igual, MVP), **arredondado para cima ao centavo**. O Organizador recebe os poucos centavos de sobra do arredondamento.
_Avoid_: Cota, Fração

**Cobrança**:
O único QR Code PIX (+ copia-e-cola) de um Racha, com o valor da Parte e apontando para a chave PIX do Organizador. Como o rateio é igual, uma só Cobrança serve todos os Participantes. Gerada no fechamento; usa PIX estático (sem PSP), então não detecta pagamento.
_Avoid_: QR, Boleto, Fatura

**Estados do Racha**:
- **Aberto**: aceita Participantes entrando, saindo e confirmando; o Organizador ajusta livremente. Rachas Abertos são públicos — descobertos por uma lista global na home, sem link nem convite.
- **Fechado**: rateio calculado, Cobranças geradas, reembolsos em andamento.
- **Concluído**: Racha encerrado pelo Organizador.
Transições: Aberto → Fechado (fechar), Fechado → Aberto (reabrir, **invalida as Cobranças** e recalcula ao fechar de novo), Fechado → Concluído.

## Relationships (adicionais)

- Um **Racha** Fechado gera exatamente uma **Cobrança** (rateio igual → valor único)
- Reabrir um **Racha** invalida a **Cobrança** e força recálculo da **Parte** no próximo fechamento

## Relationships

- Um **Racha** tem exatamente um **Organizador**
- Um **Racha** tem um ou mais **Participantes**; o **Organizador** é também um **Participante** para efeito de divisão (a Parte dele é o próprio consumo), mas não deve **Reembolso** a si mesmo
- Cada **Participante** (exceto o Organizador) deve um **Reembolso** ao **Organizador**

## Flagged ambiguities

- "pagar" foi usado de forma ambígua (pagar o restaurante vs. reembolsar o organizador) — resolvido: o app só trata o **Reembolso** ao Organizador; o pagamento ao restaurante acontece fora do app.
