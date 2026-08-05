"""Every event for the User domain. Each one is just a verb base
parameterized with User — the framework in domain/base.py does the rest.
Add fields here to change what a Create/Update call accepts; add a
handle() override here to go beyond plain CRUD.
"""

from app.domain.base import Create, Delete, GetById, ListAll, Update
from app.domain.user.entity import User


class GetUser(GetById[User]):
    pass


class ListUsers(ListAll[User]):
    pass


class CreateUser(Create[User]):
    name: str
    email: str


class UpdateUser(Update[User]):
    name: str | None = None
    email: str | None = None


class DeleteUser(Delete[User]):
    pass
