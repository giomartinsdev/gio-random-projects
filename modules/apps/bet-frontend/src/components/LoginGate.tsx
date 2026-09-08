import { Dices } from "lucide-react";
import { goToSso } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// The login wall. "Not logged in" here means the opaque-redirect probe
// failed, which is also what the very first visit after a hub login
// looks like (Access still has to mint this app's cookie) -- so this
// button is always the right answer, never an inline login form:
// Google's own page can't run inside a frame or a fetch.
export function LoginGate() {
  return (
    <Card className="mt-10">
      <CardHeader className="items-center text-center">
        <Dices className="mb-2 size-10 text-primary" />
        <CardTitle>entre para apostar</CardTitle>
        <CardDescription>
          Login com Google pelo Cloudflare Access — o mesmo do hub, uma vez só.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Button size="lg" onClick={goToSso}>
          Entrar com Google
        </Button>
      </CardContent>
    </Card>
  );
}