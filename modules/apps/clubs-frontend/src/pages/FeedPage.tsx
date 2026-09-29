// O arquivo do feed: todos os avisos derivados dos fatos que o hub acumulou.
//
// A home mostra os últimos 3 como amostra; esta tela é o arquivo completo. O
// feed é gerado, não curado: cada linha vem de um resultado, recorde ou marco
// que o worker derivou sozinho.

import { PageHead } from "../components/shell";
import { FeedList } from "../components/feed";
import { useI18n } from "../lib/i18n";
import { DocumentMeta } from "../lib/document-meta";

export function FeedPage() {
  const { t } = useI18n();
  return (
    <>
      <DocumentMeta title={t("home.feed")} description={t("home.feedEmptyHint")} path="/feed" />
      <PageHead title={t("home.feed")} sub={t("home.feedEmptyHint")} />
      <FeedList />
    </>
  );
}
