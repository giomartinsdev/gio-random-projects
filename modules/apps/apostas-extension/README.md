# financas — captura de apostas

Extensão de Chrome pessoal (não publicada na Web Store): tira um print da aba atual e manda pro
`apostas-api`, que lê com IA e registra a aposta sozinho.

## Instalar

1. `chrome://extensions` → ative "Modo do desenvolvedor" → "Carregar sem compactação" → aponte
   para esta pasta.
2. Clique com o botão direito no ícone da extensão → "Opções" (ou abra pelo menu de extensões).
3. Cole a URL do `apostas-api` (padrão: `https://apostas-api.giomartins.dev`) e o token gerado
   pelo Terraform:
   ```
   cd modules/infra/terraform && terraform output -raw apostas_extension_token
   ```
4. Salvar.

## Usar

Com o bilhete da aposta visível na tela (algumas casas, como a Betano, mostram o bilhete numa
barra lateral direto na página principal -- não precisa navegar pra outra tela, só selecionar um
mercado), clique no ícone da extensão. A tela escurece com uma seleção de área: arraste um
retângulo em volta do bilhete (casa, seleção, valor apostado, odd) e solte. Esc cancela.

Depois de soltar, uma notificação do Chrome confirma se a aposta foi registrada, ou explica por
que não (casa não reconhecida, print ilegível, etc.) -- não há tela de revisão, a aposta é
registrada direto a partir da área selecionada.

## Se a casa nunca é reconhecida

O nome que a IA lê no print precisa bater (exato ou por substring, case-insensitive) com o nome de
uma conta tipo "aposta" já cadastrada no financas. Confira o nome da conta primeiro.
