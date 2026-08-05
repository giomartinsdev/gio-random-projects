from app.domain.base import Entity


class User(Entity, table=True):
    name: str
    email: str
