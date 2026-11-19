export function NotMember() {
  return (
    <div className="mx-auto mt-24 max-w-md space-y-2 text-center">
      <h1 className="text-xl font-semibold">Not a member</h1>
      <p className="text-sm text-muted-foreground">
        This GitHub account is signed in but is not on the Musica allowlist. Ask Andre to add it.
      </p>
    </div>
  );
}
