import { useEffect, useMemo, useState } from "react";
import { searchDirectory } from "../lib/api";
import { getSessionLogin } from "../lib/session";
import { sameUser, type Me } from "./perm";

export function useMe(): Me {
  const login = getSessionLogin();
  const [teacher, setTeacher] = useState(false);

  useEffect(() => {
    if (!login) return;
    const ac = new AbortController();
    searchDirectory(login, ac.signal)
      .then((list) => {
        const u = list.find((x) => sameUser(x.login, login));
        setTeacher(u?.role?.toLowerCase() === "teacher");
      })
      .catch(() => undefined);
    return () => ac.abort();
  }, [login]);

  return useMemo(() => ({ login, teacher }), [login, teacher]);
}