export function ErrorNote({ message }: { message: string }) {
  return <p role="alert" className="error">{message}</p>;
}
