import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';

export class Role extends Model<
  InferAttributes<Role>,
  InferCreationAttributes<Role>
> {
  declare id: CreationOptional<number>;
  declare role: string;

  static associate(models: any) {
    this.belongsToMany(models.User, { through: models.UserRole });
  }
}

export default (sequelize: Sequelize) => {
  Role.init(
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      role: {
        type: DataTypes.ENUM('admin', 'user'),
        unique: true,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'Role',
      timestamps: false,
    }
  );

  return Role;
};
