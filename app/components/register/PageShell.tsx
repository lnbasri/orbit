import { Backdrop } from "~/components/ui";

/** Edge-to-edge sheet on phones; a thin-bordered glass column with a brand top rule from sm upwards. */
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <Backdrop>
      <main className="mx-auto max-w-6xl sm:px-6 sm:py-10 lg:py-14">
        <article className="relative overflow-hidden border-b border-slate-200/80 bg-white/80 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_24px_48px_-28px_rgb(15_23_42/0.18)] backdrop-blur-md sm:border">
          <div className="h-1 bg-gradient-to-r from-brand via-brand to-brand-dark" aria-hidden="true" />
          {children}
        </article>
        <footer className="flex flex-col gap-1 px-5 py-6 text-[13px] text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-0">
          <p>
            Panitia Kajian{" "}
            <a className="font-semibold text-brand hover:text-brand-dark" href="https://www.ppmedenhaag.nl/">
              PPME Den Haag
            </a>
          </p>
          <p>Semua waktu dalam waktu Belanda (Europe/Amsterdam).</p>
        </footer>
      </main>
    </Backdrop>
  );
}
