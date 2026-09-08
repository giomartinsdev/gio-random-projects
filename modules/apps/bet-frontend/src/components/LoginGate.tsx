import { motion } from "framer-motion";
import { goToSso } from "@/lib/api";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { arrowRightCircleIcon } from "@/lib/lottie-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// The login wall. "Not logged in" here means the opaque-redirect probe
// failed, which is also what the very first visit after a hub login
// looks like (Access still has to mint this app's cookie) -- so this
// button is always the right answer, never an inline login form:
// Google's own page can't run inside a frame or a fetch. Rendered
// inside App's centered column, so no page shell of its own.
export function LoginGate() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
    >
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">entre para apostar</CardTitle>
          <CardDescription>
            Login com Google pelo Cloudflare Access — o mesmo do hub, uma vez só.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
            <Button className="w-full" onClick={goToSso}>
              <AnimatedIcon animation={arrowRightCircleIcon} />
              Entrar com Google
            </Button>
          </motion.div>
        </CardContent>
      </Card>
    </motion.div>
  );
}